package app.proxygram.client

import android.Manifest
import android.app.DownloadManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import android.webkit.JavascriptInterface
import org.json.JSONObject
import java.security.MessageDigest
import kotlin.concurrent.thread

/** The system owns the download, including background work, network retries and the Downloads notification. */
class AppUpdater(private val activity: MainActivity) {
  private val manager = activity.getSystemService(DownloadManager::class.java)
  private val saved = activity.getSharedPreferences("app-update", 0)
  private var verifyingId = -1L

  @JavascriptInterface
  @Synchronized
  fun start(url: String, sha256: String, version: String): String {
    val uri = Uri.parse(url)
    require(uri.scheme == "https" && uri.host == RELEASE_HOST && uri.port in listOf(-1, 443))
    require(uri.userInfo == null && uri.path?.matches(Regex("/downloads/Proxygram_[0-9.]+_arm64\\.apk")) == true)
    require(sha256.matches(Regex("[a-fA-F0-9]{64}")) && version.matches(Regex("[0-9]+\\.[0-9]+\\.[0-9]+")))
    val previous = JSONObject(getState())
    if (previous.optString("status") in listOf("pending", "running", "paused", "verifying", "ready")
      && saved.getString("sha256", "").equals(sha256, ignoreCase = true)) return previous.toString()

    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
      && activity.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
      activity.runOnUiThread { activity.requestPermissions(arrayOf(Manifest.permission.WRITE_EXTERNAL_STORAGE), STORAGE_REQUEST) }
      return JSONObject().put("status", "storage").toString()
    }
    cancel()
    val filename = "Proxygram_${version}_${System.currentTimeMillis()}.apk"
    val request = DownloadManager.Request(uri)
      .setTitle("Proxygram $version")
      .setMimeType(APK_MIME)
      .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
      .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename)
      .setAllowedOverMetered(true)
      .setAllowedOverRoaming(false)
    val id = manager.enqueue(request)
    saved.edit().putLong("id", id).putString("sha256", sha256.lowercase())
      .putString("filename", filename).putString("version", version).putString("error", "").apply()
    return getState()
  }

  @JavascriptInterface
  @Synchronized
  fun getState(): String {
    val result = JSONObject().put("status", "idle")
    val id = saved.getLong("id", -1)
    if (id == -1L) return result.toString()
    result.put("filename", saved.getString("filename", ""))
    result.put("version", saved.getString("version", ""))
    val error = saved.getString("error", "")
    if (!error.isNullOrEmpty()) return result.put("status", "failed").put("error", error).toString()
    manager.query(DownloadManager.Query().setFilterById(id))?.use { cursor ->
      if (!cursor.moveToFirst()) return result.put("status", "failed").put("error", "DOWNLOAD_REMOVED").toString()
      val status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
      val state = when (status) {
        DownloadManager.STATUS_PENDING -> "pending"
        DownloadManager.STATUS_RUNNING -> "running"
        DownloadManager.STATUS_PAUSED -> "paused"
        DownloadManager.STATUS_SUCCESSFUL -> {
          if (manager.getUriForDownloadedFile(id) == null) "failed"
          else if (saved.getLong("verifiedId", -1) == id) "ready"
          else { verify(id); "verifying" }
        }
        else -> "failed"
      }
      result.put("status", state)
      result.put("downloaded", cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)))
      val total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
      if (total > 0) result.put("total", total)
      if (state == "failed") result.put("error", "DOWNLOAD_${cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))}")
    }
    return result.toString()
  }

  @JavascriptInterface
  @Synchronized
  fun cancel() {
    val id = saved.getLong("id", -1)
    if (id != -1L) manager.remove(id)
    saved.edit().clear().apply()
  }

  @JavascriptInterface
  @Synchronized
  fun install(): String {
    val id = saved.getLong("id", -1)
    check(id != -1L && saved.getLong("verifiedId", -1) == id)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.packageManager.canRequestPackageInstalls()) {
      activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
      return "permission"
    }
    val uri = checkNotNull(manager.getUriForDownloadedFile(id))
    activity.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, APK_MIME)
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
    return "opened"
  }

  /** The hash is computed off the UI and JavaScript bridge threads, including after an app restart. */
  private fun verify(id: Long) {
    if (verifyingId == id) return
    verifyingId = id
    val expected = saved.getString("sha256", "")
    thread(name = "apk-verify") {
      val valid = runCatching {
        val uri = checkNotNull(manager.getUriForDownloadedFile(id))
        val digest = MessageDigest.getInstance("SHA-256")
        activity.contentResolver.openInputStream(uri)!!.use { input ->
          val buffer = ByteArray(64 * 1024)
          while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            digest.update(buffer, 0, count)
          }
        }
        digest.digest().joinToString("") { "%02x".format(it) } == expected
      }.getOrDefault(false)
      synchronized(this) {
        if (saved.getLong("id", -1) == id) {
          if (valid) saved.edit().putLong("verifiedId", id).apply()
          else {
            saved.edit().putString("error", "SHA256_MISMATCH").apply()
            manager.remove(id)
          }
        }
        if (verifyingId == id) verifyingId = -1
      }
    }
  }

  private companion object {
    const val RELEASE_HOST = "proxygram.azhuleev.ru"
    const val APK_MIME = "application/vnd.android.package-archive"
    const val STORAGE_REQUEST = 710
  }
}

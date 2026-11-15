package app.proxygram.client

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStream
import java.util.UUID

/**
 * What the page cannot do inside the app's web view (`src/proxygram/nativeBridge.ts`): open a link in the system
 * browser — Tauri's `shell.open` looks for `xdg-open` on Android and fails silently — and save a file to Downloads,
 * since the web view ignores `<a download>`. The page writes a file in base64 chunks: begin → chunk… → finish.
 */
class NativeBridge(private val activity: MainActivity) {
  private class PendingFile(val stream: OutputStream, val uri: Uri?, val file: File?, val name: String)

  private val pending = mutableMapOf<String, PendingFile>()

  @JavascriptInterface
  fun openUrl(url: String): Boolean {
    val uri = runCatching { Uri.parse(url) }.getOrNull() ?: return false
    if (uri.scheme?.lowercase() !in OPEN_SCHEMES) return false
    return try {
      activity.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      true
    } catch (_: ActivityNotFoundException) {
      false
    }
  }

  /** An id for the chunks, "storage" when Android 9 and older still need the permission, "" on failure */
  @JavascriptInterface
  @Synchronized
  fun saveBegin(name: String, mimeType: String): String {
    val safeName = name.replace(Regex("[\\\\/:*?\"<>|\\u0000-\\u001f]"), "_").trim().ifEmpty { "file" }.take(MAX_NAME)
    val mime = mimeType.ifBlank { "application/octet-stream" }
    return try {
      val entry = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val values = ContentValues().apply {
          put(MediaStore.Downloads.DISPLAY_NAME, safeName)
          put(MediaStore.Downloads.MIME_TYPE, mime)
          put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri = activity.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return ""
        val stream = activity.contentResolver.openOutputStream(uri, "w") ?: return ""
        PendingFile(stream, uri, null, safeName)
      } else {
        if (activity.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
          != PackageManager.PERMISSION_GRANTED) {
          activity.runOnUiThread {
            activity.requestPermissions(arrayOf(Manifest.permission.WRITE_EXTERNAL_STORAGE), STORAGE_REQUEST)
          }
          return "storage"
        }
        @Suppress("DEPRECATION")
        val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        dir.mkdirs()
        val file = uniqueFile(dir, safeName)
        PendingFile(FileOutputStream(file), null, file, file.name)
      }
      val id = UUID.randomUUID().toString()
      pending[id] = entry
      id
    } catch (_: Exception) {
      ""
    }
  }

  @JavascriptInterface
  @Synchronized
  fun saveChunk(id: String, base64: String): Boolean {
    val entry = pending[id] ?: return false
    return try {
      entry.stream.write(Base64.decode(base64, Base64.DEFAULT))
      true
    } catch (_: Exception) {
      saveCancel(id)
      false
    }
  }

  /** The name the file got in Downloads, "" on failure */
  @JavascriptInterface
  @Synchronized
  fun saveFinish(id: String): String {
    val entry = pending.remove(id) ?: return ""
    return try {
      entry.stream.close()
      entry.uri?.let { uri ->
        activity.contentResolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
        displayName(uri) ?: entry.name
      } ?: entry.name
    } catch (_: Exception) {
      cleanup(entry)
      ""
    }
  }

  @JavascriptInterface
  @Synchronized
  fun saveCancel(id: String) {
    val entry = pending.remove(id) ?: return
    runCatching { entry.stream.close() }
    cleanup(entry)
  }

  private fun cleanup(entry: PendingFile) {
    entry.uri?.let { runCatching { activity.contentResolver.delete(it, null, null) } }
    entry.file?.delete()
  }

  private fun displayName(uri: Uri): String? = activity.contentResolver
    .query(uri, arrayOf(MediaStore.Downloads.DISPLAY_NAME), null, null, null)
    ?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }

  private fun uniqueFile(dir: File, name: String): File {
    val dot = name.lastIndexOf('.').takeIf { it > 0 } ?: name.length
    val base = name.substring(0, dot)
    val extension = name.substring(dot)
    var file = File(dir, name)
    var index = 1
    while (file.exists()) file = File(dir, "$base ($index)$extension").also { index++ }
    return file
  }

  private companion object {
    val OPEN_SCHEMES = setOf("http", "https", "mailto", "tel", "tg", "geo")
    const val MAX_NAME = 200
    const val STORAGE_REQUEST = 4242
  }
}

package app.proxygram.client

import android.content.Intent
import android.webkit.JavascriptInterface
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.net.URI

/** Интерфейс для доверенной страницы клиента. Запуск службы всегда идёт из видимой Activity. */
class AndroidNotificationBridge(private val activity: MainActivity) {
  @JavascriptInterface
  fun show(raw: String) {
    parse(raw)?.let { notification ->
      val target = notification.optJSONObject("target") ?: return
      val lines = notification.optJSONArray("lines")
      MessageNotifications.show(activity, target, notification.optString("title"), notification.optString("body"),
        notification.optBoolean("isSilent"), List(minOf(lines?.length() ?: 0, 6)) { lines!!.optString(it) })
    }
  }

  @JavascriptInterface
  fun read(raw: String, maxId: Int) {
    val target = parse(raw) ?: return
    MessageNotifications.read(activity, target, maxId)
  }

  @JavascriptInterface
  fun setVisible(raw: String) {
    MessageNotifications.visibleTarget = parse(raw)
  }

  @JavascriptInterface
  fun peekTap(): String = activity.notificationTap.get().orEmpty()

  @JavascriptInterface
  fun consumeTap(receipt: String) {
    val tap = activity.notificationTap.get()
    if (tap != null && parse(tap)?.optString("receipt") == receipt) activity.notificationTap.compareAndSet(tap, null)
  }

  @JavascriptInterface
  @Synchronized
  fun ensureRunning(slot: Int, userId: String, sessionId: String, endpoint: String, hidePreviews: Boolean): Boolean {
    val config = AndroidInboxConfig.get(activity, slot) ?: return false
    if (config.optString("userId") != userId || config.optString("sessionId") != sessionId ||
      config.optString("endpoint") != endpoint || config.optLong("expiresAt") < System.currentTimeMillis() + RENEW_BEFORE) {
      return false
    }
    if (config.optBoolean("hidePreviews") != hidePreviews) {
      AndroidInboxConfig.withCurrent(activity, slot, config.getString("token")) {
        AndroidInboxConfig.put(activity, slot, it.put("hidePreviews", hidePreviews))
      }
    }
    if (!AndroidInboxService.isRunning) start()
    return true
  }

  @JavascriptInterface
  @Synchronized
  fun configure(slot: Int, raw: String): Boolean {
    if (slot !in 1..99 || !MessageNotifications.isAllowed(activity)) return false
    val config = parse(raw) ?: return false
    val url = runCatching { URI(config.getString("endpoint")) }.getOrNull() ?: return false
    val allowedScheme = url.scheme == "https" || (BuildConfig.DEBUG && url.scheme == "http")
    if (!allowedScheme || url.host == null || url.userInfo != null || url.query != null || url.fragment != null ||
      !url.path.endsWith("/push/android") || !AndroidInboxConfig.validCursor(config.optString("cursor")) ||
      config.optString("token").isEmpty() || config.optString("sessionId").isEmpty() || config.optString("userId").isEmpty()) {
      return false
    }
    return runCatching {
      val previous = AndroidInboxConfig.get(activity, slot)
      val sameDevice = previous != null && previous.optString("userId") == config.getString("userId") &&
        previous.optString("sessionId") == config.getString("sessionId") && previous.optString("endpoint") == url.toString()
      if (sameDevice) {
        config.put("cursor", previous.getString("cursor"))
      }
      AndroidInboxConfig.put(activity, slot, config)
      if (!sameDevice) MessageNotifications.clearSlot(activity, slot)
      start()
      true
    }.getOrDefault(false)
  }

  @JavascriptInterface
  @Synchronized
  fun stop(slot: Int) {
    if (slot !in 1..99) return
    AndroidInboxConfig.remove(activity, slot)
    MessageNotifications.clearSlot(activity, slot)
    val intent = Intent(activity, AndroidInboxService::class.java)
    if (AndroidInboxConfig.slots(activity).isEmpty()) activity.stopService(intent)
    else if (AndroidInboxService.isRunning) start()
  }

  private fun start() {
    activity.runOnUiThread {
      if (MessageNotifications.isActivityVisible && MessageNotifications.isAllowed(activity)) {
        runCatching { ContextCompat.startForegroundService(activity, Intent(activity, AndroidInboxService::class.java)) }
      }
    }
  }

  private fun parse(raw: String): JSONObject? = raw.takeIf { it.length in 1..32_768 }
    ?.let { runCatching { JSONObject(it) }.getOrNull() }

  private companion object {
    const val RENEW_BEFORE = 24 * 60 * 60_000L
  }
}

package app.proxygram.client

import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.AtomicFile
import androidx.core.app.ServiceCompat
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URI

/** Нативная доставка сообщений Proxygram, пока Android держит разрешённую фоновую службу. */
class AndroidInboxService : Service() {
  private val receivers = mutableMapOf<Int, Receiver>()
  private val main = Handler(Looper.getMainLooper())

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (!MessageNotifications.isAllowed(this)) {
      stopSelf()
      return START_NOT_STICKY
    }
    if (Build.VERSION.SDK_INT >= 26) {
      val manager = getSystemService(NotificationManager::class.java)
      manager.createNotificationChannel(android.app.NotificationChannel(
        CHANNEL, getString(R.string.pxg_background_notifications), NotificationManager.IMPORTANCE_LOW,
      ))
    }
    val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
    val notification = MessageNotifications.notificationBuilder(this, CHANNEL)
      .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
      .setContentTitle(getString(R.string.pxg_background_notifications))
      .setContentIntent(open).setOngoing(true).setShowWhen(false).build()
    val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING else 0
    ServiceCompat.startForeground(this, SERVICE_NOTIFICATION, notification, type)
    isRunning = true
    reconcile()
    return START_STICKY
  }

  private fun reconcile() {
    val slots = AndroidInboxConfig.slots(this).associateWith { AndroidInboxConfig.get(this, it) }
    receivers.entries.removeAll { (slot, receiver) ->
      val changed = slots[slot]?.optString("token") != receiver.token
      if (changed) receiver.stop()
      changed
    }
    for ((slot, config) in slots) {
      if (config != null && slot !in receivers) receivers[slot] = Receiver(slot, config).apply { start() }
    }
    if (receivers.isEmpty()) stopSelf()
  }

  override fun onDestroy() {
    receivers.values.forEach { it.stop() }
    receivers.clear()
    isRunning = false
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  private inner class Receiver(private val slot: Int, private val config: JSONObject) {
    val token: String = config.getString("token")
    private val user: String = config.getString("userId")
    private val endpoint: String = config.getString("endpoint")
    private var cursor: String = config.getString("cursor")
    private val thread = Thread(::loop, "proxygram-notifications-$slot")
    @Volatile private var active = true
    @Volatile private var connection: HttpURLConnection? = null

    fun start() = thread.start()

    fun stop() {
      active = false
      thread.interrupt()
      connection?.disconnect()
    }

    private fun loop() {
      var retryMs = 2_000L
      while (active) {
        if (!MessageNotifications.isAllowed(this@AndroidInboxService)) {
          main.post { stopSelf() }
          return
        }
        try {
          val request = URI("$endpoint?after=$cursor").toURL().openConnection() as HttpURLConnection
          connection = request
          request.connectTimeout = 10_000
          request.readTimeout = 38_000
          request.instanceFollowRedirects = false
          request.setRequestProperty("Authorization", "Bearer $token")
          request.setRequestProperty("Accept", "application/json")
          try {
            val status = request.responseCode
            if (status == 401 || status == 404) {
              main.post {
                if (AndroidInboxConfig.remove(this@AndroidInboxService, slot, token)) {
                  MessageNotifications.clearSlot(this@AndroidInboxService, slot)
                }
                reconcile()
              }
              return
            }
            check(status == 200)
            val response = request.inputStream.bufferedReader(Charsets.UTF_8).use { JSONObject(it.readText()) }
            if (!active) return
            // Проверка под тем же замком, что и смена аккаунта: старый поток ничего не покрасит новому слоту.
            AndroidInboxConfig.withCurrent(this@AndroidInboxService, slot, token) { current ->
              val next = response.getString("cursor")
              if (!AndroidInboxConfig.validCursor(next)) return@withCurrent
              val events = response.getJSONArray("events")
              for (i in 0 until events.length()) deliver(events.getJSONObject(i), current.optBoolean("hidePreviews"))
              if (cursor != next) {
                cursor = next
                AndroidInboxConfig.put(this@AndroidInboxService, slot, current.put("cursor", next))
              }
            }
            retryMs = 2_000L
          } finally {
            request.disconnect()
            connection = null
          }
        } catch (_: Exception) {
          if (!active) return
          try {
            Thread.sleep(retryMs)
          } catch (_: InterruptedException) {
            return
          }
          retryMs = minOf(retryMs * 2, 120_000L)
        }
      }
    }

    private fun deliver(event: JSONObject, hidePreviews: Boolean) {
      val read = event.optJSONObject("pxgRead")
      val peer = read ?: event.optJSONObject("pxg") ?: return
      val target = JSONObject()
        .put("accountId", peer.getString("accountId")).put("peerId", peer.getLong("peerId"))
        .put("slot", slot).put("pxgUserId", user).put("threadId", peer.optInt("topicId"))
      if (read != null) {
        MessageNotifications.read(this@AndroidInboxService, target, read.getInt("maxId"))
      } else {
        target.put("messageId", peer.getInt("msgId"))
        val title = if (hidePreviews) getString(R.string.app_name) else event.getString("title")
        val body = if (hidePreviews) getString(R.string.pxg_new_message) else event.getString("body")
        MessageNotifications.show(this@AndroidInboxService, target,
          title, body, event.optBoolean("isSilent"), emptyList())
      }
    }
  }

  companion object {
    private const val CHANNEL = "proxygram.background"
    private const val SERVICE_NOTIFICATION = 86420
    @Volatile var isRunning = false
      private set
  }
}

/** Токен даёт только право получать уведомления и хранится в каталоге без системного бэкапа. */
object AndroidInboxConfig {
  private val cursorPattern = Regex("[0-9]{1,15}-[0-9]{1,10}")
  private val filePattern = Regex("pxg-inbox-([1-9][0-9]?)\\.json")
  private fun file(context: Context, slot: Int) = AtomicFile(File(context.noBackupFilesDir, "pxg-inbox-$slot.json"))

  fun validCursor(cursor: String) = cursorPattern.matches(cursor)

  fun slots(context: Context): List<Int> = context.noBackupFilesDir.list().orEmpty()
    .mapNotNull { filePattern.matchEntire(it)?.groupValues?.get(1)?.toIntOrNull() }

  @Synchronized
  fun get(context: Context, slot: Int): JSONObject? = runCatching {
    JSONObject(file(context, slot).readFully().toString(Charsets.UTF_8))
  }.getOrNull()

  @Synchronized
  fun put(context: Context, slot: Int, config: JSONObject) {
    val file = file(context, slot)
    val stream = file.startWrite()
    try {
      stream.write(config.toString().toByteArray(Charsets.UTF_8))
      file.finishWrite(stream)
    } catch (error: Exception) {
      file.failWrite(stream)
      throw error
    }
  }

  @Synchronized
  fun remove(context: Context, slot: Int, token: String? = null): Boolean {
    if (token != null && get(context, slot)?.optString("token") != token) return false
    file(context, slot).delete()
    return true
  }

  @Synchronized
  fun withCurrent(context: Context, slot: Int, token: String, block: (JSONObject) -> Unit) {
    val current = get(context, slot) ?: return
    if (current.optString("token") == token) block(current)
  }
}

package app.proxygram.client

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import org.json.JSONObject
import java.util.UUID

/** Общие системные уведомления для WebView и службы доставки. */
object MessageNotifications {
  const val OPEN_MESSAGE = "app.proxygram.client.OPEN_MESSAGE"
  const val TARGET = "proxygram.notification.target"
  private const val MESSAGE_ID = 1
  private const val MESSAGES = "proxygram.messages"
  private const val SILENT = "proxygram.messages.silent"
  private val latest = LinkedHashMap<String, Int>()

  @Volatile var isActivityVisible = false
  @Volatile var visibleTarget: JSONObject? = null

  fun isAllowed(context: Context): Boolean = (
    Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
  ) && context.getSystemService(NotificationManager::class.java).areNotificationsEnabled()

  private fun peer(target: JSONObject): String {
    val account = target.optString("accountId")
    return if (account.isNotEmpty()) "$account:${target.optLong("peerId")}" else target.optString("chatId")
  }

  private fun prefix(target: JSONObject): String {
    val user = target.optString("pxgUserId").ifEmpty { target.optString("ownerId") }
    return "pxg:${target.optInt("slot", 1)}:$user:${peer(target)}:"
  }

  @Synchronized
  fun show(context: Context, target: JSONObject, title: String, body: String, silent: Boolean, lines: List<String>) {
    val message = target.optInt("messageId")
    if (message <= 0 || peer(target).isEmpty() || !isAllowed(context)) return
    val thread = target.optInt("threadId")
    val peerPrefix = prefix(target)
    val visible = visibleTarget
    if (isActivityVisible && visible != null && prefix(visible) == peerPrefix &&
      (visible.optInt("threadId") == thread || visible.optBoolean("allTopics"))) return

    val reaction = target.optBoolean("reaction")
    val tag = "$peerPrefix$thread" + if (reaction) ":reaction" else ""
    if (!reaction && message <= (latest[tag] ?: 0)) return
    target.put("receipt", UUID.randomUUID().toString())
    val intent = Intent(context, MainActivity::class.java).apply {
      action = OPEN_MESSAGE
      data = Uri.Builder().scheme("proxygram-notification").authority("message").appendPath(tag).build()
      putExtra(TARGET, target.toString())
      addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
    val open = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val manager = context.getSystemService(NotificationManager::class.java)
    val channel = if (silent) SILENT else MESSAGES
    if (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(channel) == null) {
      val channelName = context.getString(if (silent) R.string.pxg_silent_messages else R.string.pxg_messages)
      val importance = if (silent) NotificationManager.IMPORTANCE_LOW else NotificationManager.IMPORTANCE_HIGH
      manager.createNotificationChannel(NotificationChannel(channel, channelName, importance))
    }
    val builder = notificationBuilder(context, channel)
      .setSmallIcon(android.R.drawable.stat_notify_chat)
      .setContentTitle(title).setContentText(body).setContentIntent(open).setAutoCancel(true)
      .setCategory(Notification.CATEGORY_MESSAGE).setVisibility(Notification.VISIBILITY_PRIVATE)
      .setGroup("pxg-messages")
    if (Build.VERSION.SDK_INT < 26 && !silent) {
      @Suppress("DEPRECATION")
      builder.setDefaults(Notification.DEFAULT_SOUND or Notification.DEFAULT_VIBRATE)
    }
    if (lines.size > 1) {
      val style = Notification.InboxStyle().setBigContentTitle(title)
      lines.takeLast(6).forEach { style.addLine(it) }
      builder.setStyle(style)
    } else {
      builder.setStyle(Notification.BigTextStyle().bigText(body))
    }
    builder.extras.putInt("pxgMessageId", message)
    manager.notify(tag, MESSAGE_ID, builder.build())
    if (!reaction) {
      latest.remove(tag)
      latest[tag] = message
      if (latest.size > 256) latest.remove(latest.keys.first())
    }
  }

  @Synchronized
  fun read(context: Context, target: JSONObject, maxId: Int) {
    val prefix = prefix(target)
    val thread = target.optInt("threadId")
    val manager = context.getSystemService(NotificationManager::class.java)
    for (active in manager.activeNotifications) {
      val tag = active.tag ?: continue
      if (active.id != MESSAGE_ID || !tag.startsWith(prefix) || tag.endsWith(":reaction")) continue
      if (thread > 0 && tag != "$prefix$thread") continue
      if (active.notification.extras.getInt("pxgMessageId") <= maxId) manager.cancel(tag, MESSAGE_ID)
    }
    if (thread > 0) {
      val tag = "$prefix$thread"
      latest[tag] = maxOf(maxId, latest[tag] ?: 0)
    }
  }

  @Synchronized
  fun clearSlot(context: Context, slot: Int) {
    val prefix = "pxg:$slot:"
    val manager = context.getSystemService(NotificationManager::class.java)
    manager.activeNotifications.filter { it.tag?.startsWith(prefix) == true }
      .forEach { manager.cancel(it.tag, it.id) }
    latest.keys.removeAll { it.startsWith(prefix) }
  }

  @Suppress("DEPRECATION")
  fun notificationBuilder(context: Context, channel: String): Notification.Builder =
    if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, channel) else Notification.Builder(context)
}

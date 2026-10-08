package com.jarvis.ai.audio

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Process
import android.util.Base64
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Native realtime PCM output engine.
 *
 * Android owns the output clock, queue and AudioTrack. The WebView only forwards
 * already-decoded Gemini PCM packets through the typed Capacitor bridge.
 */
class JarvisAudioEngine {

    private val running = AtomicBoolean(false)
    private val queue = LinkedBlockingQueue<ByteArray>(256)

    @Volatile
    private var track: AudioTrack? = null

    @Volatile
    private var worker: Thread? = null

    @Synchronized
    fun start(sampleRate: Int = 24000) {
        if (running.get()) return

        val minBuffer = AudioTrack.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )

        require(minBuffer > 0) { "Android audio output is unavailable" }

        val bufferSize = maxOf(minBuffer * 2, sampleRate / 5)

        val audioTrack = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setSampleRate(sampleRate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .build()
            )
            .setBufferSizeInBytes(bufferSize)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()

        require(audioTrack.state == AudioTrack.STATE_INITIALIZED) {
            audioTrack.release()
            "Android AudioTrack could not be initialized"
        }

        track = audioTrack
        queue.clear()
        running.set(true)

        worker = Thread {
            try {
                Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO)
                audioTrack.play()

                while (running.get()) {
                    val packet = queue.poll(100, TimeUnit.MILLISECONDS) ?: continue
                    if (!running.get()) break

                    var offset = 0
                    while (offset < packet.size && running.get()) {
                        val written = audioTrack.write(
                            packet,
                            offset,
                            packet.size - offset,
                            AudioTrack.WRITE_BLOCKING
                        )
                        if (written <= 0) break
                        offset += written
                    }
                }
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            } catch (_: Throwable) {
                // The bridge owns lifecycle/error reporting. Never crash the UI thread.
            } finally {
                try { audioTrack.pause() } catch (_: Throwable) {}
                try { audioTrack.flush() } catch (_: Throwable) {}
                try { audioTrack.stop() } catch (_: Throwable) {}
                try { audioTrack.release() } catch (_: Throwable) {}
                synchronized(this) {
                    if (track === audioTrack) track = null
                    worker = null
                }
            }
        }.apply { name = "JarvisAudioOutput" }

        worker?.start()
    }

    fun enqueueBase64Pcm(base64: String, sampleRate: Int = 24000) {
        if (!running.get()) start(sampleRate)

        val bytes = Base64.decode(base64, Base64.NO_WRAP)
        if (bytes.isEmpty()) return

        if (!queue.offer(bytes)) {
            Thread.yield()
            if (!queue.offer(bytes)) return
        }
    }

    @Synchronized
    fun flush() {
        queue.clear()
        track?.let { audioTrack ->
            try { audioTrack.pause() } catch (_: Throwable) {}
            try { audioTrack.flush() } catch (_: Throwable) {}
            try { audioTrack.play() } catch (_: Throwable) {}
        }
    }

    @Synchronized
    fun stop() {
        running.set(false)
        queue.clear()
        worker?.interrupt()
        worker = null

        track?.let {
            try { it.pause() } catch (_: Throwable) {}
            try { it.flush() } catch (_: Throwable) {}
            try { it.stop() } catch (_: Throwable) {}
            try { it.release() } catch (_: Throwable) {}
        }
        track = null
    }

    fun clearQueue() {
        queue.clear()
    }
}

package com.jarvis.ai.audio

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Process
import android.util.Base64
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

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

    /**
     * Fired when every PCM frame submitted to AudioTrack has actually been
     * rendered by the hardware (playbackHeadPosition caught up with the
     * submitted frames) and the queue is empty. Also fired after flush()/stop(),
     * which both discard pending audio by definition.
     */
    @Volatile
    var onPlaybackIdle: Runnable? = null

    // Total 16-bit PCM frames written into the current AudioTrack. Compared
    // against playbackHeadPosition to detect real playback completion.
    private val framesWritten = AtomicLong(0)
    private val idleNotified = AtomicBoolean(true)

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
        framesWritten.set(0)
        idleNotified.set(true)
        running.set(true)

        worker = Thread {
            try {
                Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO)
                audioTrack.play()

                while (running.get()) {
                    val packet = queue.poll(100, TimeUnit.MILLISECONDS)
                    if (packet == null) {
                        maybeNotifyIdle(audioTrack)
                        continue
                    }
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
                        // 16-bit mono: 2 bytes per frame submitted to the track.
                        framesWritten.addAndGet((written / 2).toLong())
                        idleNotified.set(false)
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

    private fun maybeNotifyIdle(audioTrack: AudioTrack) {
        if (idleNotified.get()) return

        val written = framesWritten.get()
        if (written <= 0L) {
            idleNotified.set(true)
            return
        }

        // playbackHeadPosition is an unsigned 32-bit frame counter of audio
        // actually rendered. Unsign it before comparing with frames written.
        val head = audioTrack.playbackHeadPosition.toLong() and 0xFFFFFFFFL
        if (head >= written) {
            idleNotified.set(true)
            onPlaybackIdle?.run()
        }
    }

    fun enqueuePcmBytes(bytes: ByteArray, sampleRate: Int = 24000) {
        if (!running.get()) start(sampleRate)
        if (bytes.isEmpty()) return

        if (!queue.offer(bytes)) {
            Thread.yield()
            if (!queue.offer(bytes)) return
        }
    }

    fun enqueueBase64Pcm(base64: String, sampleRate: Int = 24000) {
        enqueuePcmBytes(Base64.decode(base64, Base64.NO_WRAP), sampleRate)
    }

    @Synchronized
    fun flush() {
        queue.clear()
        track?.let { audioTrack ->
            try { audioTrack.pause() } catch (_: Throwable) {}
            try { audioTrack.flush() } catch (_: Throwable) {}
            try { audioTrack.play() } catch (_: Throwable) {}
        }
        // AudioTrack.flush() discards unplayed audio and rewinds the playback
        // head, so whatever was pending is gone: playback is idle again.
        framesWritten.set(0)
        idleNotified.set(true)
        onPlaybackIdle?.run()
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
        framesWritten.set(0)
        idleNotified.set(true)
        onPlaybackIdle?.run()
    }

    fun clearQueue() {
        queue.clear()
    }
}

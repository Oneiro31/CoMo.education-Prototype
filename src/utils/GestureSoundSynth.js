
// To convert intensity.norm to audio gain
const INTENSITY_AUDIO_MIN_GAIN = 0;
const INTENSITY_AUDIO_MAX_GAIN = 1.2;
const INTENSITY_AUDIO_SCALE = 0.7;
const INTENSITY_AUDIO_SMOOTHING = 0.04;

// -------- Audio Synthesis  -------------------
export class GestureSoundSynth {
  constructor({ audioContext, soundbank, output }) {
    this.audioContext = audioContext;

    this.soundbank = {
      ...soundbank,
    };

    // CoMo output
    this.output = output;


    // Gain controlled by the intensity of the movement
    this.intensityGain = new GainNode(
      this.audioContext,
      { gain: INTENSITY_AUDIO_MIN_GAIN },
    );


    // General gain of the synthesis
    this.master = new GainNode(
      this.audioContext,
      { gain: 1 },
    );


    this.intensityGain.connect(this.master);
    this.master.connect(this.output);
    this.activeSources = new Set();
    this.currentChannel = null;
    this.currentLoopLabel = null;

  }

  get labels() {
    return Object.keys(this.soundbank);
  }


  hasSound(label) {
    return Boolean(label && this.soundbank[label]);
  }



  addSound(label, audioBuffer) {
    if (!label || !audioBuffer) {
      return false;
    }

    this.soundbank[label] = audioBuffer;
    return true;
  }


  removeSound(label) {
    if (!label || !this.soundbank[label]) {
      return false;
    }


    //Stop the audio if it is currently playing.
    for (const channel of [...this.activeSources]) {
      if (channel.label === label) {
        this.stopChannel(channel, {
          fade: false,
        });
      }
    }

    delete this.soundbank[label];

    if (this.currentLoopLabel === label) {
      this.currentLoopLabel = null;
      this.currentChannel = null;
    }

    return true;
  }



  // ------ Fade In ------
  fadeIn(time = 0.2) {
    this.master.gain.setTargetAtTime(
      1,
      this.audioContext.currentTime,
      time,
    );
  }


  // --- Fade Out ---
  fadeOut(time = 0.2) {
    this.master.gain.setTargetAtTime(
      0,
      this.audioContext.currentTime,
      time,
    );
  }


  setIntensity(intensityNorm) {
    if (!Number.isFinite(intensityNorm)) {
      return;
    }

    // intensity.norm is not restricted to [0, 1]
    // So we first create a bounded value
    const normalizedIntensity =
      Math.max(
        0,
        Math.min(1, intensityNorm * INTENSITY_AUDIO_SCALE),
      );

    // Configuring the output gain based on intensity
    const targetGain = INTENSITY_AUDIO_MIN_GAIN + normalizedIntensity
      * (INTENSITY_AUDIO_MAX_GAIN - INTENSITY_AUDIO_MIN_GAIN);

    const now = this.audioContext.currentTime;

    //Audio smoothing to prevent clicks and
    // sudden changes in volume.
    this.intensityGain.gain.cancelScheduledValues(now);

    this.intensityGain.gain.setTargetAtTime(
      targetGain,
      now,
      INTENSITY_AUDIO_SMOOTHING,
    );

  }

  resetIntensityGain() {
    const now = this.audioContext.currentTime;
    this.intensityGain.gain.cancelScheduledValues(now);

    this.intensityGain.gain.setTargetAtTime(
      1,
      now,
      0.03,
    );
  }



  // ---------- Play Sound ---------
  play(label, options = {}) {
    const {
      gain = 1,
      loop = false,
      when = this.audioContext.currentTime,
      fadeInTime = 0,
      onEnded = null,
    } = options;

    const buffer = this.soundbank[label];

    if (!buffer) {
      console.warn(`No sound found for "${label}"`);
      return null;
    }

    const src = new AudioBufferSourceNode(this.audioContext, {
      buffer,
      loop,
    });

    const amplitude = new GainNode(this.audioContext, {
      gain: fadeInTime > 0 ? 0 : gain,
    });

    src.connect(amplitude).connect(this.intensityGain);

    const channel = {
      label,
      src,
      amplitude,
    };

    this.activeSources.add(channel);

    src.onended = () => {
      this.activeSources.delete(channel);

      if (this.currentChannel === channel) {
        this.currentChannel = null;
      }

      if (this.currentLoopLabel === label && this.currentChannel === null) {
        this.currentLoopLabel = null;
      }

      try {
        src.disconnect();
        amplitude.disconnect();
      } catch (err) {}

      if (typeof onEnded === 'function') {
        onEnded(channel);
      }

    };

    src.start(when);

    if (fadeInTime > 0) {
      amplitude.gain.setValueAtTime(0, when);
      amplitude.gain.setTargetAtTime(gain, when, fadeInTime);
    }

    return channel;
  }



  // ---------- Preview Sound ---------
  preview(label, options = {}) {
    const {
      onEnded = null,
    } = options;

    //  We cut what's playing and reset the volume to 1.
    this.stopAll();

    // Previewing the soundbank never depends on movement
    this.resetIntensityGain();

    this.master.gain.setValueAtTime(
      1,
      this.audioContext.currentTime,
    );

    const channel = this.play(label, {
      gain: 1,
      loop: false,
      onEnded,
    });

    this.currentChannel = channel;

    return channel;
  }


  // ---------- Loop Sound ---------
  loop(label, options = {}) {
    const {
      fadeInTime = 0.1,
      fadeOutTime = 0.1,
      gain = 1,
    } = options;

    if (this.currentLoopLabel === label && this.currentChannel) {
      return this.currentChannel;
    }

    // Old sound: fade out
    for (const channel of [...this.activeSources]) {
      this.stopChannel(channel, {
        fade: true,
        fadeOutTime,
      });
    }

    // New sound : fade in
    const channel = this.play(label, {
      gain,
      loop: true,
      fadeInTime,
    });

    this.currentChannel = channel;
    this.currentLoopLabel = label;

    return channel;
  }


  // ---------- Stop Channel ---------
  stopChannel(channel, options = {}) {
    if (!channel) {
      return;
    }

    const {
      fade = false,
      fadeOutTime = 0.1,
      stopDelay = fadeOutTime * 2,
    } = options;

    if (fade) {
      const now = this.audioContext.currentTime;
      const stopTime = now + stopDelay;

      try {
        channel.amplitude.gain.cancelScheduledValues(now);
        channel.amplitude.gain.setValueAtTime(channel.amplitude.gain.value, now);
        channel.amplitude.gain.setTargetAtTime(0, now, fadeOutTime);

        channel.src.stop(stopTime);
      } catch (err) {}
    } else {
      try {
        channel.src.stop();
      } catch (err) {}
    }

    this.activeSources.delete(channel);

    if (this.currentChannel === channel) {
      this.currentChannel = null;
      this.currentLoopLabel = null;
    }
  }


  // ------ Stop All ------
  stopAll(options = {}) {
    for (const channel of [...this.activeSources]) {
      this.stopChannel(channel, options);
    }

    if (!options.fade) {
      this.activeSources.clear();
    }

    this.currentChannel = null;
    this.currentLoopLabel = null;
  }


  // ------ Disconnect ------
  disconnect() {
    this.stopAll();

    try {
      this.intensityGain.disconnect();
    } catch (err) {}


    try {
      this.master.disconnect();
    } catch (err) {}


  }


  // ------ Play files out the soundbank ------
  playBuffer(audioBuffer, options = {}) {
    const {
      gain = 1,
      when = this.audioContext.currentTime,
      onEnded = null,
    } = options;

    if (!audioBuffer) {
      return null;
    }

    const src = new AudioBufferSourceNode(this.audioContext, {
      buffer: audioBuffer,
      loop: false,
    });

    const amplitude = new GainNode(this.audioContext, {
      gain,
    });

    src.connect(amplitude).connect(this.master);

    const channel = {
      label: '__internal_buffer__',
      src,
      amplitude,
    };

    this.activeSources.add(channel);

    src.onended = () => {
      this.activeSources.delete(channel);

      try {
        src.disconnect();
        amplitude.disconnect();
      } catch (err) {}

      if (typeof onEnded === 'function') {
        onEnded(channel);
      }
    };

    src.start(when);
    return channel;
  }



}

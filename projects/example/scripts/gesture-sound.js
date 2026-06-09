const {
  audioContext,
  como,
} = getGlobalScriptingContext();


// -------- Share State ----------
export async function defineSharedState() {
  return {
    classDescription: {
      labels: {
        type: 'any',
        default: [],
      },

      selectedLabel: {
        type: 'string',
        default: null,
        nullable: true,
      },


      previewLabel: {
        type: 'string',
        default: null,
        nullable: true,
      },


      record: {
        type: 'boolean',
        default: false,
      },


      mode: {
        type: 'string',
        default: 'learn',
      },

      training: {
        type: 'boolean',
        default: false,
      },


      recognizedLabel: {
        type: 'string',
        default: null,
        nullable: true,
      },


      examples: {
        type: 'any',
        default: {},
      },


      deleteExampleUuid: {
        type: 'string',
        default: null,
        nullable: true,
      },


      clearLabel: {
        type: 'string',
        default: null,
        nullable: true,
      },


      clearAllRequest: {
        type: 'integer',
        default: 0,
      },


      status: {
        type: 'string',
        default: 'idle',
      },


      lastMessage: {
        type: 'string',
        default: '',
      },

      lastError: {
        type: 'string',
        default: '',
      },
    },

    initValues: {},
  };
}



const MODEL_ID = 'gesture-sound_short';
const MODEL_PRESET = 'shortGestures';

const FRAME_TIMEOUT_MS = 500;
const FRAME_TIMEOUT_INTERVAL_MS = 200;

let model = null;
let synth = null;
let recordExample = null;
let unsubscribeState = null;
let unsubscribeModel = null;
let lastClearAllRequest = 0;
let frameTimeoutInterval = null;
let lastFrameTime = 0;



// -------- Audio Synthesis  -------------------
class GestureSoundSynth {
  constructor({ audioContext, soundbank, output }) {
    this.audioContext = audioContext;
    this.soundbank = soundbank;

    // CoMo output
    this.output = output;

    // General gain of the synthesis
    this.master = new GainNode(this.audioContext, {
      gain: 1,
    });

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

  // --- Fade In ---
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

    src.connect(amplitude).connect(this.master);

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
      this.master.disconnect();
    } catch (err) {}
  }
}



// --------------- Enter () --------------
export async function enter(context) {
  const { state, soundbank, output } = context;

  synth = new GestureSoundSynth({
    audioContext,
    soundbank,
    output,
  });


  lastFrameTime = performance.now();

  frameTimeoutInterval = setInterval(() => {
    if (!synth || !state) {
      return;
    }

    const now = performance.now();
    const time = now - lastFrameTime;

    const isPlaying = state.get('mode') === 'play';

    if (isPlaying && time > FRAME_TIMEOUT_MS) {
      synth.stopAll({
        fade: true,
        fadeOutTime: 0.05,
      });

      state.set({
        recognizedLabel: null,
        status: 'source-timeout',
        lastMessage: 'Pas de données IMU : son arrêté.',
      });
    }
  }, FRAME_TIMEOUT_INTERVAL_MS);


  const labels = Object.keys(soundbank);


  await state.set({
    labels,
    selectedLabel: labels.length > 0 ? labels[0] : null,
    previewLabel: null,
    record: false,
    mode: 'learn',
    training: false,
    recognizedLabel: null,
    examples: {},
    status: 'loading-model',
    lastMessage: 'Chargement du modèle XMM...',
  });

  model = await como.modelManager.getModel(MODEL_ID, {
    preset: MODEL_PRESET,
  });

  syncExamplesToState(state);

  unsubscribeModel = model.state.onUpdate(updates => {
    if ('infos' in updates || 'parameters' in updates) {
      syncExamplesToState(state);
    }
  }, true);

  lastClearAllRequest = state.get('clearAllRequest') || 0;

  unsubscribeState = state.onUpdate(async updates => {
    try {
      if ('previewLabel' in updates) {
        const label = updates.previewLabel;

        if (label) {
          const channel = synth.preview(label, {
            onEnded: () => {
              // Ne réinitialise que si ce son est toujours l'aperçu courant
              if (state.get('previewLabel') === label) {
                void state.set({
                  previewLabel: null,
                  lastMessage: `Lecture terminée : "${label}"`,
                }).catch(err => {
                  console.error(
                    '[gesture-sound] erreur de fin de preview :',
                    err,
                  );
                });
              }
            },
          });

          if (!channel) {
            await state.set({
              previewLabel: null,
              lastError: `Impossible de lire le son "${label}".`,
            });

            return;
          }

          await state.set({
            lastMessage: `Lecture de "${label}"`,
            lastError: '',
          });
        } else {
          synth.stopAll({
            fade: true,
            fadeOutTime: 0.1,
          });

          await state.set({
            lastMessage: 'Lecture arrêtée.',
          });
        }
      }


      if ('selectedLabel' in updates) {
        if (synth) {
          synth.stopAll({
            fade: true,
            fadeOutTime: 0.1,
          });
        }

        await state.set({
          recognizedLabel: null,
          status: 'ready',
          lastMessage: updates.selectedLabel
            ? `Son sélectionné : ${updates.selectedLabel}`
            : 'Aucun son sélectionné',
        });

      }


      if ('record' in updates) {
        if (updates.record === true) {
          await startRecording(state);
        } else {
          await stopRecordingAndTrain(state);
        }
      }

      if ('mode' in updates) {
        if (updates.mode !== 'play' && synth) {
          synth.stopAll({
            fade: true,
            fadeOutTime: 0.1,
          });
        }

        await state.set({
          recognizedLabel: null,
          status: updates.mode === 'play' ? 'playing' : 'ready',
          lastMessage: updates.mode === 'play'
            ? 'Mode de jeu activé'
            : 'Mode d’apprentissage activé',
        });
      }

      if ('deleteExampleUuid' in updates && updates.deleteExampleUuid) {
        await deleteExample(state, updates.deleteExampleUuid);
      }

      if ('clearLabel' in updates && updates.clearLabel) {
        await clearExamplesForLabel(state, updates.clearLabel);
      }

      if ('clearAllRequest' in updates) {
        const nextRequest = updates.clearAllRequest;

        if (nextRequest > lastClearAllRequest) {
          lastClearAllRequest = nextRequest;
          await clearAllExamples(state);
        }
      }
    } catch (err) {
      console.error('state update error:', err);

      await state.set({
        training: false,
        status: 'error',
        lastError: err.message || String(err),
      });
    }
  });

  await state.set({
    status: 'ready',
    lastMessage: 'Application prête.',
  });
}


// -------- Exit () ------------------
export async function exit() {
  if (unsubscribeState) {
    unsubscribeState();
    unsubscribeState = null;
  }

  if (unsubscribeModel) {
    unsubscribeModel();
    unsubscribeModel = null;
  }

  if (synth) {
    synth.disconnect();
    synth= null;
  }

  if (model) {
    await model.detach();
    model = null;
  }

  if (frameTimeoutInterval) {
    clearInterval(frameTimeoutInterval);
    frameTimeoutInterval = null;
  }

  recordExample = null;
}


// ---------- Process () --------------------
export async function process(context, frame) {
  lastFrameTime = performance.now();

  const { state } = context;

  if (!model || state.get('training')) {
    return;
  }

  const xmmFrame = [
    frame[0].accelerometer.x,
    frame[0].accelerometer.y,
    frame[0].accelerometer.z,
    frame[0].gyroscope.x,
    frame[0].gyroscope.y,
    frame[0].gyroscope.z,
  ];

  if (state.get('record')) {
    if (recordExample) {
      recordExample.push(xmmFrame);
    }

    return;
  }

  if (state.get('mode') !== 'play') {
    return;
  }

  let results = null;

  try {
    results = model.process(xmmFrame);
  } catch (err) {
    console.error('Erreur process :', err);
    return;
  }

  if (!results) {
    return;
  }

  const labels = results.labels;
  const scores = results.smoothedNormalizedLikelihoods;

  if (
    !Array.isArray(labels)
    || !scores
    || labels.length === 0
  ) {
    return;
  }

  let winnerLabel = null;
  let winnerScore = -Infinity;

  labels.forEach((label, index) => {
    const score = Number(scores[index]);

    if (Number.isFinite(score) && score > winnerScore) {
      winnerLabel = label;
      winnerScore = score;
    }
  });

  if (!winnerLabel) {
    synth?.stopAll({
      fade: true,
      fadeOutTime: 0.3,
    });

    return;
  }

  if (!synth) {
    return;
  }

  synth.loop(winnerLabel, {
    fadeInTime: 0.2,
    fadeOutTime: 0.1,
  });

  if (state.get('recognizedLabel') !== winnerLabel) {
    state.set({
      recognizedLabel: winnerLabel,
      status: 'recognized',
      lastMessage: `Geste reconnu : ${winnerLabel}`,
      lastError: '',
    });
  }
}


// ------- Start Recording --------
async function startRecording(state) {
  const label = state.get('selectedLabel');

  if (!label) {
    recordExample = null;

    await state.set({
      record: false,
      status: 'error',
      lastError: 'Aucun son sélectionné pour enregistrer le geste.',
    });

    return;
  }

  recordExample = [];

  await state.set({
    mode: 'learn',
    training: false,
    recognizedLabel: null,
    status: 'recording',
    lastMessage: `Enregistrement du geste pour "${label}"...`,
    lastError: '',
  });
}


// ------- Stop Recording and Train --------
async function stopRecordingAndTrain(state) {
  if (!recordExample) {
    return;
  }

  const label = state.get('selectedLabel');
  const example = recordExample;
  recordExample = null;

  if (!label) {
    await state.set({
      status: 'error',
      lastError: 'Impossible de sauvegarder : aucun son sélectionné.',
    });

    return;
  }

  if (!isValidExample(example)) {
    await state.set({
      status: 'ready',
      lastError: 'Exemple vide ou invalide. Recommence le geste.',
    });

    return;
  }

  await state.set({
    training: true,
    status: 'training',
    lastMessage: `Entraînement XMM pour "${label}" (${example.length} frames)...`,
    lastError: '',
  });

  await model.addExample(label, example);
  syncExamplesToState(state);

  await state.set({
    training: false,
    status: 'ready',
    lastMessage: `Geste ajouté pour "${label}".`,
  });
}


// ------- Delete Example --------
async function deleteExample(state, uuid) {
  await state.set({
    training: true,
    status: 'deleting-example',
    lastMessage: 'Suppression du geste...',
    lastError: '',
  });

  await model.deleteExample(uuid);
  syncExamplesToState(state);

  await state.set({
    deleteExampleUuid: null,
    training: false,
    status: 'ready',
    lastMessage: 'Geste supprimé.',
  });
}


// ------- Delete All Example --------
async function clearExamplesForLabel(state, label) {
  await state.set({
    training: true,
    status: 'clearing-label',
    lastMessage: `Suppression des gestes pour "${label}"...`,
  });

  await model.clearExamples(label);
  syncExamplesToState(state);

  await state.set({
    clearLabel: null,
    training: false,
    status: 'ready',
    lastMessage: `Tous les gestes pour "${label}" ont été supprimés.`,
  });
}

// ------ Clear all Examples ------
async function clearAllExamples(state) {
  await state.set({
    training: true,
    status: 'clearing-all',
    lastMessage: 'Suppression de tous les gestes...',
  });

  await model.clearExamples();
  syncExamplesToState(state);

  await state.set({
    training: false,
    status: 'ready',
    recognizedLabel: null,
    lastMessage: 'Tous les gestes ont été supprimés.',
  });
}


// ------ Sync Examples from Model State to Shared State -----
function syncExamplesToState(state) {
  if (!model) {
    return;
  }

  const infos = model.state.get('infos') || {};

  state.set({
    examples: infos,
  });
}


// ------ Validate Example Format --------
function isValidExample(example) {
  if (!Array.isArray(example) || example.length === 0) {
    return false;
  }

  if (!Array.isArray(example[0])) {
    return false;
  }

  const dimension = example[0].length;

  if (dimension <= 0) {
    return false;
  }

  return example.every(frame => {
    return Array.isArray(frame)
      && frame.length === dimension
      && frame.every(value => Number.isFinite(value));
  });
}

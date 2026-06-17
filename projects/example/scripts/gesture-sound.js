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

      userSoundFiles: {
        type: 'any',
        default: [],
      },

      reloadUserSoundsRequest: {
        type: 'integer',
        default: 0,
      },

      selectedLabel: {
        type: 'string',
        default: null,
        nullable: true,
      },


      gestureName: {
        type: 'string',
        default: '',
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


      waitingGesture: {
        type: 'any',
        default: null,
        nullable: true,
      },

      waitingPreview: {
        type: 'boolean',
        default: false,
      },

      validateWaitingRequest: {
        type: 'integer',
        default: 0,
      },

      cancelWaitingRequest: {
        type: 'integer',
        default: 0,
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
const WAITING_LABEL_PREFIX = '__waiting__:';



let model = null;
let synth = null;
let recordExample = null;

let unsubscribeState = null;
let unsubscribeModel = null;
let lastClearAllRequest = 0;
let frameTimeoutInterval = null;
let lastFrameTime = 0;
let waitingExample = null;
let waitingInfos = null;
let recordingInfos = null;



// -------- Audio Synthesis  -------------------
class GestureSoundSynth {
  constructor({ audioContext, soundbank, output }) {
    this.audioContext = audioContext;

    this.soundbank = {
      ...soundbank,
    };

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


  addSound(label, audioBuffer) {
    if (!label || !audioBuffer) {
      return false;
    }

    this.soundbank[label] = audioBuffer;
    return true;
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
        lastMessage: 'Arret du son',
        lastError: 'Pas de données IMU',
      });
    }
  }, FRAME_TIMEOUT_INTERVAL_MS);


  const labels = Object.keys(soundbank);


  await state.set({
    labels,
    userSoundFiles: [],
    reloadUserSoundsRequest: 0,

    selectedLabel: labels.length > 0 ? labels[0] : null,
    gestureName:'',
    previewLabel: null,
    record: false,
    mode: 'learn',
    training: false,
    recognizedLabel: null,
    examples: {},

    waitingGesture: null,
    waitingPreview: false,
    validateWaitingRequest: 0,
    cancelWaitingRequest: 0,

    status: 'loading-model',
    lastMessage: 'Chargement du modèle XMM...',
  });

  model = await como.modelManager.getModel(MODEL_ID, {
    preset: MODEL_PRESET,
  });

  await clearWaitingExamples();
  await syncExamplesToState(state);

  unsubscribeModel = model.state.onUpdate(updates => {
    if ('infos' in updates || 'parameters' in updates) {
      syncExamplesToState(state);
    }
  }, true);

  lastClearAllRequest = state.get('clearAllRequest') || 0;

  unsubscribeState = state.onUpdate(async updates => {
    try {

      if (
        'userSoundFiles' in updates
        || 'reloadUserSoundsRequest'
        in updates
      ) {
        await loadUserSounds(state);
      }


      if ('previewLabel' in updates) {
        const label = updates.previewLabel;

        if (label) {
          const channel = synth.preview(label, {
            onEnded: () => {

              if (state.get('previewLabel') === label) {
                void state.set({
                  previewLabel: null,
                  lastMessage: `Lecture terminée : "${label}"`,
                }).catch(err => {
                  console.error(
                    'erreur de fin de preview :',
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
          await stopRecordingAndPreparePreview(state);
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


      if ('validateWaitingRequest' in updates && updates.validateWaitingRequest > 0) {
        await validateWaitingGesture(state);
      }

      if ('cancelWaitingRequest' in updates && updates.cancelWaitingRequest > 0) {
        await cancelWaitingGesture(state);
      }

      if ('waitingPreview' in updates) {
        if (updates.waitingPreview === true) {
          await state.set({
            recognizedLabel: null,
            status: 'previewing-waiting',
            lastMessage:
              'Test actif : refaites maintenant le geste enregistré.',
            lastError: '',
          });
        } else {
          synth?.stopAll({
            fade: true,
            fadeOutTime: 0.1,
          });

          await state.set({
            recognizedLabel: null,
            status: 'waiting-validation',
            lastMessage:
              'Test arrêté. Validez ou annulez le geste.',
          });
        }
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

  const isWaitingPreview =
    state.get('waitingPreview') === true;
  // En dehors du test temporaire, la reconnaissance normale
  // fonctionne seulement en mode play.
  if (
    !isWaitingPreview
    && state.get('mode') !== 'play'
  ) {
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



  // ------ Reconnaissance temporaire ---------
  if (isWaitingPreview) {
    if (!waitingInfos) {
      synth?.stopAll({
        fade: true,
        fadeOutTime: 0.2,
      });

      return;
    }

    const temporaryLabel = waitingInfos.temporaryLabel;

    let previewWinnerLabel = null;
    let previewWinnerScore = -Infinity;

    labels.forEach((label, index) => {
      /*
       * On accepte :
       * - le geste temporaire actuel ;
       * - tous les gestes déjà validés.
       *
       * On ignore uniquement d'éventuels anciens
       * labels temporaires qui ne correspondent pas
       * au geste en cours.
       */
      const isOtherWaitingLabel =
        label.startsWith(WAITING_LABEL_PREFIX)
        && label !== temporaryLabel;

      if (isOtherWaitingLabel) {
        return;
      }

      const score = Number(scores[index]);

      if (
        Number.isFinite(score)
        && score > previewWinnerScore
      ) {
        previewWinnerLabel = label;
        previewWinnerScore = score;
      }
    });

    /*
     * Le geste temporaire est reconnu uniquement
     * s'il est le meilleur résultat produit par XMM.
     */
    const accepted =
      previewWinnerLabel === temporaryLabel;

    if (accepted) {
      synth?.loop(waitingInfos.soundLabel, {
        fadeInTime: 0.2,
        fadeOutTime: 0.1,
      });

      if (
        state.get('recognizedLabel')
        !== waitingInfos.gestureName
      ) {
        state.set({
          recognizedLabel:
          waitingInfos.gestureName,

          status: 'preview-recognized',

          lastMessage:
            `Geste reconnu : ${waitingInfos.gestureName}`,

          lastError: '',
        });
      }
    } else {
      synth?.stopAll({
        fade: true,
        fadeOutTime: 0.2,
      });

      if (
        state.get('recognizedLabel') !== null
        || state.get('status')
        !== 'preview-not-recognized'
      ) {
        state.set({
          recognizedLabel: null,
          status: 'preview-not-recognized',
          lastMessage: 'Geste testé non reconnu.',
          lastError: '',
        });
      }
    }

    return;
  }



  // ------ Reconnaissance normale ---------
  let winnerLabel = null;
  let winnerScore = -Infinity;


  labels.forEach((label, index) => {
    // Ne jamais utiliser un geste temporaire en mode Jouer
    if (label.startsWith(WAITING_LABEL_PREFIX)) {
      return;
    }

    const score = Number(scores[index]);

    if (
      Number.isFinite(score)
      && score > winnerScore
    ) {
      winnerLabel = label;
      winnerScore = score;
    }
  });


  if (!winnerLabel) {
    synth?.stopAll({
      fade: true,
      fadeOutTime: 0.3,
    });


    if (state.get('recognizedLabel') !== null || state.get('status') !== 'playing') {
      state.set({
        recognizedLabel: null,
        status: 'playing',
        lastMessage: 'Aucun geste reconnu.',
        lastError: '',
      });
    }

    return;
  }


  if (!synth) {
    return;
  }


  const {
    gestureName,
    soundLabel,
  } = parseModelLabel(winnerLabel);


  synth.loop(soundLabel, {
    fadeInTime: 0.2,
    fadeOutTime: 0.1,
  });


  if (state.get('recognizedLabel') !== gestureName) {
    state.set({
      recognizedLabel: gestureName,
      status: 'recognized',
      lastMessage: `Geste reconnu : ${gestureName} — son : ${soundLabel}`,
      lastError: '',
    });
  }
}



const MODEL_LABEL_SEPARATOR = '|||';

function createModelLabel(gestureName, soundLabel) {
  return [
    encodeURIComponent(gestureName.trim()),
    encodeURIComponent(soundLabel),
  ].join(MODEL_LABEL_SEPARATOR);
}

function parseModelLabel(modelLabel) {
  const parts = modelLabel.split(MODEL_LABEL_SEPARATOR);

  // Compatibilité avec les anciens exemples
  if (parts.length !== 2) {
    return {
      gestureName: modelLabel,
      soundLabel: modelLabel,
    };
  }

  return {
    gestureName: decodeURIComponent(parts[0]),
    soundLabel: decodeURIComponent(parts[1]),
  };
}




// ------- Start Recording --------
async function startRecording(state) {
  const soundLabel = state.get('selectedLabel');
  const gestureName= state.get('gestureName')?.trim();

  if (!soundLabel) {
    recordExample = null;
    recordingInfos= null;

    await state.set({
      record: false,
      status: 'error',
      lastError: 'Aucun son sélectionné pour enregistrer le geste.',
    });

    return;
  }


  if (!gestureName) {
    recordExample = null;
    recordingInfos = null;

    await state.set({
      record: false,
      status: 'error',
      lastError:
        'Veuillez donner un nom au geste avant de commencer.',
    });

    return;
  }

  const modelLabel = createModelLabel(
    gestureName,
    soundLabel,
  );

  recordingInfos = {
    gestureName,
    soundLabel,
    modelLabel,
  };

  recordExample = [];


  await state.set({
    mode: 'learn',
    training: false,
    recognizedLabel: null,
    status: 'recording',
    lastMessage: `Enregistrement du geste "${gestureName}" pour le son "${soundLabel}"...`,
    lastError: '',
  });
}


// ------- Stop Recording and Train --------
async function stopRecordingAndPreparePreview(state) {
  if (!recordExample) {
    return;
  }

  const example = recordExample;
  recordExample = null;

  const soundLabel = state.get('selectedLabel');

  // Utilise le nom libre si tu as ajouté gestureName.
  // Sinon, le nom du son sert temporairement de nom de geste.
  const gestureName =
    state.get('gestureName')?.trim()
    || soundLabel;

  if (!soundLabel) {
    await state.set({
      status: 'error',
      lastError:
        'Impossible de préparer le geste : aucun son sélectionné.',
    });

    return;
  }

  if (!gestureName) {
    await state.set({
      status: 'error',
      lastError:
        'Veuillez donner un nom au geste.',
    });

    return;
  }

  if (!isValidExample(example)) {
    await state.set({
      status: 'ready',
      lastError:
        'Exemple vide ou invalide. Recommencez le geste.',
    });

    return;
  }

  const temporaryLabel =
    `${WAITING_LABEL_PREFIX}${Date.now()}`;

  const finalLabel = createModelLabel(
    gestureName,
    soundLabel,
  );

  waitingExample = example;

  waitingInfos = {
    temporaryLabel,
    finalLabel,
    gestureName,
    soundLabel,
  };

  await state.set({
    training: true,
    status: 'preparing-preview',
    lastMessage:
      `Préparation du test du geste "${gestureName}"...`,
    lastError: '',
  });


  // Ajout temporaire dans XMM
  await model.addExample(
    temporaryLabel,
    example,
  );

  await state.set({
    waitingGesture: {
      gestureName,
      soundLabel,
    },

    waitingPreview: false,
    training: false,
    status: 'waiting-validation',

    lastMessage:
      `Le geste "${gestureName}" est prêt à être testé.`,
  });
}



// ------- Validate Waiting Gesture --------
async function validateWaitingGesture(state) {
  if (!waitingExample || !waitingInfos) {
    await state.set({
      lastError:
        'Aucun geste temporaire à valider.',
    });

    return;
  }

  const {
    temporaryLabel,
    finalLabel,
    gestureName,
    soundLabel,
  } = waitingInfos;

  synth?.stopAll({
    fade: true,
    fadeOutTime: 0.1,
  });

  await state.set({
    waitingPreview: false,
    training: true,
    status: 'validating-gesture',
    lastMessage:
      `Validation du geste "${gestureName}"...`,
    lastError: '',
  });


  // Ajout définitif
  await model.addExample(
    finalLabel,
    waitingExample,
  );

  // Suppression de la classe temporaire
  await model.clearExamples(temporaryLabel);

  waitingExample = null;
  waitingInfos = null;

  await syncExamplesToState(state);

  await state.set({
    waitingGesture: null,
    waitingPreview: false,
    validateWaitingRequest: 0,

    gestureName: '',
    training: false,
    status: 'ready',

    lastMessage:
      `Geste "${gestureName}" associé au son "${soundLabel}".`,
  });
}


// ------- Cancel Waiting Gesture --------
async function cancelWaitingGesture(state) {
  synth?.stopAll({
    fade: true,
    fadeOutTime: 0.1,
  });

  if (waitingInfos?.temporaryLabel) {
    await model.clearExamples(
      waitingInfos.temporaryLabel,
    );
  }

  const gestureName = waitingInfos?.gestureName || 'le geste';

  waitingExample = null;
  waitingInfos = null;

  await syncExamplesToState(state);

  await state.set({
    waitingGesture: null,
    waitingPreview: false,
    cancelWaitingRequest: 0,

    training: false,
    recognizedLabel: null,
    status: 'ready',

    lastMessage:
      `Enregistrement de "${gestureName}" annulé.`,
    lastError: '',
  });
}



async function clearWaitingExamples() {
  if (!model) {
    return;
  }

  const infos = model.state.get('infos') || {};
  const labels = Object.keys(infos);

  for (const label of labels) {
    if (label.startsWith(WAITING_LABEL_PREFIX)) {
      await model.clearExamples(label);
    }
  }
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
  await syncExamplesToState(state);

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
  await syncExamplesToState(state);

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
  await syncExamplesToState(state);

  await state.set({
    training: false,
    status: 'ready',
    recognizedLabel: null,
    lastMessage: 'Tous les gestes ont été supprimés.',
  });
}


// ------ Sync Examples from Model State to Shared State -----
async function syncExamplesToState(state) {
  if (!model) {
    return;
  }

  const infos =
    model.state.get('infos') || {};

  const examples = {};

  for (const [modelLabel, modelInfos] of Object.entries(infos)) {

    // Les labels temporaires ne sont pas affichés
    if (
      modelLabel.startsWith(
        WAITING_LABEL_PREFIX,
      )
    ) {
      continue;
    }

    const {
      gestureName,
      soundLabel,
    } = parseModelLabel(modelLabel);

    examples[modelLabel] = {
      ...modelInfos,
      gestureName,
      soundLabel,
    };
  }

  await state.set({
    examples,
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



async function loadUserSounds(state) {
  if (!synth) {
    return;
  }

  const userSoundFiles =
    state.get('userSoundFiles')
    || [];

  if (
    !Array.isArray(userSoundFiles)
  ) {
    return;
  }

  let loadedCount = 0;
  const errors = [];

  for (const soundFile of userSoundFiles) {
    const label = String(
      soundFile?.label || '',
    ).trim();

    const url =
      soundFile?.url;

    if (!label || !url) {
      continue;
    }

    /*
     * Les noms sont rendus uniques
     * au moment de l’upload.
     */
    if (synth.hasSound(label)) {
      continue;
    }

    try {
      const response =
        await fetch(url);

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}`,
        );
      }

      const arrayBuffer =
        await response.arrayBuffer();

      const audioBuffer =
        await audioContext
          .decodeAudioData(
            arrayBuffer.slice(0),
          );

      synth.addSound(
        label,
        audioBuffer,
      );

      loadedCount += 1;
    } catch (error) {
      console.error(
        `Impossible de charger "${label}" :`,
        error,
      );

      errors.push(label);
    }
  }

  const nextLabels =
    synth.labels.sort(
      (a, b) =>
        a.localeCompare(b),
    );

  const currentSelectedLabel =
    state.get('selectedLabel');

  const nextSelectedLabel =
    currentSelectedLabel
    && nextLabels.includes(
      currentSelectedLabel,
    )
      ? currentSelectedLabel
      : nextLabels[0] || null;


  await state.set({
    labels: nextLabels,

    selectedLabel:
    nextSelectedLabel,

    status:
      errors.length > 0
        ? 'sound-loading-error'
        : 'ready',

    lastMessage:
      loadedCount > 0
        ? `${loadedCount} nouveau(x) son(s) chargé(s).`
        : state.get('lastMessage'),

    lastError:
      errors.length > 0
        ? `Impossible de charger : ${errors.join(', ')}`
        : '',
  });
}

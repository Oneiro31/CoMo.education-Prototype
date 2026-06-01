
const {
  audioContext,
  como,
} = getGlobalScriptingContext();

const MODEL_ID = 'gesture-sound';

let model = null;
let currentExample = null;
let unsubscribeState = null;
let unsubscribeModel = null;

let lastTriggeredLabel = null;
let lastTriggerTime = 0;
let lastClearAllRequest = 0;

export async function defineSharedState() {
  return {
    classDescription: {
      labels: {
        type: 'any',
        default: [] },

      selectedLabel: {
        type: 'string',
        default: null,
        nullable: true },

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

      scores: {
        type: 'any',
        default: {},
      },

      examples: {
        type: 'any',
        default: {} },

      threshold: {
        type: 'float',
        default: 0.65,
      },

      // Faire autrement pour boucler ?
      cooldown: {
        type: 'integer',
        default: 800,
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
        default: '' },

      lastError: {
        type: 'string',
        default: '',
      },
    },

    initValues: {},
  };
}

export async function enter(context) {
  const { state, soundbank } = context;

  const labels = Object.keys(soundbank);

  await state.set({
    labels,
    selectedLabel: labels.length > 0 ? labels[0] : null,
    previewLabel: null,
    record: false,
    mode: 'learn',
    training: false,
    recognizedLabel: null,
    scores: {},
    examples: {},
    status: 'loading-model',
    lastMessage: 'Chargement du modèle XMM...',
    lastError: '',
  });

  model = await como.modelManager.getModel(MODEL_ID);

  syncExamplesToState(state);

  unsubscribeModel = model.state.onUpdate(updates => {
    if ('infos' in updates || 'parameters' in updates) {
      syncExamplesToState(state);
    }
  }, true);

  lastClearAllRequest = state.get('clearAllRequest') || 0;

  unsubscribeState = state.onUpdate(async updates => {
    try {
      if ('previewLabel' in updates && updates.previewLabel) {
        playSound(context, updates.previewLabel);

        await state.set({
          previewLabel: null,
          lastMessage: `Lecture de "${updates.previewLabel}"`,
          lastError: '',
        });
      }

      if ('record' in updates) {
        if (updates.record === true) {
          await startRecording(state);
        } else {
          await stopRecordingAndTrain(state);
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
      console.error('[gesture-sound] state update error:', err);

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

export async function exit() {
  if (unsubscribeState) {
    unsubscribeState();
    unsubscribeState = null;
  }

  if (unsubscribeModel) {
    unsubscribeModel();
    unsubscribeModel = null;
  }

  if (model) {
    await model.detach();
    model = null;
  }

  currentExample = null;
}

export function process(context, frame) {
  const { state } = context;

  if (!model || state.get('training')) {
    return;
  }

  const xmmFrame = frameToXmmVector(frame);

  if (!xmmFrame) {
    return;
  }

  if (state.get('record')) {
    if (currentExample) {
      currentExample.push(xmmFrame);
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
    return;
  }

  if (!results) {
    return;
  }

  const scores = resultsToScores(results);

  state.set({ scores });

  const winner = getWinner(results, state.get('threshold'));

  if (!winner) {
    return;
  }

  const now = audioContext.currentTime * 1000;
  const cooldown = state.get('cooldown');

  if (!shouldTrigger(winner.label, now, cooldown)) {
    return;
  }

  playSound(context, winner.label);

  lastTriggeredLabel = winner.label;
  lastTriggerTime = now;

  state.set({
    recognizedLabel: winner.label,
    status: 'recognized',
    lastMessage: `Geste reconnu : "${winner.label}"`,
  });
}

async function startRecording(state) {
  const label = state.get('selectedLabel');

  if (!label) {
    currentExample = null;

    await state.set({
      record: false,
      status: 'error',
      lastError: 'Aucun son sélectionné pour enregistrer le geste.',
    });

    return;
  }

  currentExample = [];

  await state.set({
    mode: 'learn',
    training: false,
    scores: {},
    recognizedLabel: null,
    status: 'recording',
    lastMessage: `Enregistrement du geste pour "${label}"...`,
    lastError: '',
  });
}

async function stopRecordingAndTrain(state) {
  if (!currentExample) {
    return;
  }

  const label = state.get('selectedLabel');
  const example = currentExample;
  currentExample = null;

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

async function clearExamplesForLabel(state, label) {
  await state.set({
    training: true,
    status: 'clearing-label',
    lastMessage: `Suppression des gestes pour "${label}"...`,
    lastError: '',
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


async function clearAllExamples(state) {
  await state.set({
    training: true,
    status: 'clearing-all',
    lastMessage: 'Suppression de tous les gestes...',
    lastError: '',
  });

  await model.clearExamples();
  syncExamplesToState(state);

  await state.set({
    training: false,
    status: 'ready',
    scores: {},
    recognizedLabel: null,
    lastMessage: 'Tous les gestes ont été supprimés.',
  });
}


function syncExamplesToState(state) {
  if (!model) {
    return;
  }

  const infos = model.state.get('infos') || {};

  state.set({
    examples: infos,
  });
}


function frameToXmmVector(frame) {
  const data = Array.isArray(frame) ? frame[0] : frame;

  if (!data) {
    return null;
  }

  const acc = data.accelerometer || data.accelerationIncludingGravity;

  if (!acc) {
    return null;
  }

  const values = [
    Number(acc.x),
    Number(acc.y),
    Number(acc.z),
  ];

  if (!values.every(Number.isFinite)) {
    return null;
  }

  return values;
}

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

function resultsToScores(results) {
  const scores = {};

  if (!results.labels || !results.smoothedNormalizedLikelihoods) {
    return scores;
  }

  results.labels.forEach((label, index) => {
    scores[label] = results.smoothedNormalizedLikelihoods[index];
  });

  return scores;
}

function getWinner(results, threshold) {
  if (!results.labels || !results.smoothedNormalizedLikelihoods) {
    return null;
  }

  let best = null;

  results.labels.forEach((label, index) => {
    const score = results.smoothedNormalizedLikelihoods[index];

    if (!best || score > best.score) {
      best = { label, score };
    }
  });

  if (!best || best.score < threshold) {
    return null;
  }

  return best;
}

function shouldTrigger(label, now, cooldownMs) {
  if (label !== lastTriggeredLabel) {
    return true;
  }

  return now - lastTriggerTime >= cooldownMs;
}

function playSound(context, label) {
  const { output, soundbank } = context;
  const buffer = soundbank[label];

  if (!buffer) {
    console.warn(`[gesture-sound] Aucun son trouvé pour "${label}"`);
    return;
  }

  const src = audioContext.createBufferSource();
  src.buffer = buffer;
  src.connect(output);
  src.start();
}

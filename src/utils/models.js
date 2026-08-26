import {
  MODEL_LABEL_SEPARATOR,
  WAITING_LABEL_PREFIX,
} from './config.js';



// --------- Create Model Label ----------
export function createModelLabel(gestureName, soundLabel) {
  return [
    encodeURIComponent(gestureName.trim()),
    encodeURIComponent(soundLabel),
  ].join(MODEL_LABEL_SEPARATOR);
}



// --------- Parse Model Label ----------
export function parseModelLabel(modelLabel) {
  const parts = modelLabel.split(MODEL_LABEL_SEPARATOR);

  // Backward Compatibility with Previous Examples
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




// ------ Validate Example Format --------
export function isValidExample(example) {
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





// --------- Clear Waiting Examples ----------
export async function clearWaitingExamples(model) {
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
export async function deleteExample(model, state, uuid) {
  await state.set({
    training: true,
    status: 'deleting-example',
    lastMessage: 'Suppression du geste...',
    lastError: '',
  });

  await model.deleteExample(uuid);
  await syncExamplesToState(model, state);

  await state.set({
    deleteExampleUuid: null,
    training: false,
    status: 'ready',
    lastMessage: 'Geste supprimé.',
  });
}




// ------- Delete All Example --------
export async function clearExamplesForLabel(model, state, label) {
  await state.set({
    training: true,
    status: 'clearing-label',
    lastMessage: `Suppression des gestes pour "${label}"...`,
  });

  await model.clearExamples(label);
  await syncExamplesToState(model, state);

  await state.set({
    clearLabel: null,
    training: false,
    status: 'ready',
    lastMessage: `Tous les gestes pour "${label}" ont été supprimés.`,
  });
}





// ------ Clear all Examples ------
export async function clearAllExamples(model, state) {
  await state.set({
    training: true,
    status: 'clearing-all',
    lastMessage: 'Suppression de tous les gestes...',
  });

  await model.clearExamples();
  await syncExamplesToState(model, state);

  await state.set({
    training: false,
    status: 'ready',
    recognizedLabel: null,
    lastMessage: 'Tous les gestes ont été supprimés.',
  });
}


// ------ Sync Examples from Model State to Shared State -----
export async function syncExamplesToState(model, state) {
  if (!model) {
    return;
  }

  const infos = model.state.get('infos') || {};
  const examples = {};

  for (const [modelLabel, modelInfos] of Object.entries(infos)) {

    // Temporary labels are not displayed
    if (modelLabel.startsWith(WAITING_LABEL_PREFIX)
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

  await state.set({ examples });
}



import {
  Hysteresis
} from '@ircam/sc-signal';

const {
  audioContext,
  audioBufferLoader,
  como,
} = getGlobalScriptingContext();

export async function defineSharedState(como) {
  return {
    classDescription: {
      labels: {
        type: 'any',
        default: [],
      },
      previewLabel: {
        type: 'string',
        // default: '08-clicks.mp3',
        default: null,
        nullable: true,
      },
      recordLabel: {
        type: 'string',
        default: null,
        nullable: true,
      },
      record: {
        type: 'boolean',
        default: false,
      },
    },
    // initValues:  { play: false },
  };
}

let labels = null;
let model = null;
let recordExample = null; // array containing the example when record is true
let previewLabel = null; // bypass decoded label to preview some soundfile
let previewSrc = null;
let unsubscribeModel = null;

class ParallelSynth {
  constructor(audioContext, soundbank, model) {
    this.audioContext = audioContext;
    this.soundbank = soundbank;
    this.model = model;
    this.output = new GainNode(this.audioContext);
    this.sources = {};

    this.unsubscribe = this.model.state.onUpdate(updates => {
      if ('parameters' in updates) {
        const classes = Object.keys(updates.parameters.classes);
        const sources = Object.keys(this.sources);
        const toAdd = classes.filter(label => !sources.includes(label));
        const toRemove = sources.filter(label => !classes.includes(label));

        toAdd.forEach(label => {
          const buffer = this.soundbank[label];
          const src = new AudioBufferSourceNode(this.audioContext, { buffer, loop: true });
          const env = new GainNode(this.audioContext, { gain: 0 });
          src.connect(env).connect(this.output);
          src.start();

          const hysteresis = new Hysteresis({
            sampleRate: 2, // normalised frequency
            lowpassFrequencyUp: 0.5,
            lowpassFrequencyDown: 0.05,
          });

          this.sources[label] = { src, env, hysteresis };
        });

        toRemove.forEach(label => {
          const { src, env } = this.sources[label];
          src.stop();
          src.disconnect();
          env.disconnect();
          delete this.sources[label];
        });
      }
    }, true);
  }

  delete() {
    this.unsubscribe();
  }

  fadeIn() {
    this.output.gain.setTargetAtTime(1, this.audioContext.currentTime, 0.005);
  }

  fadeOut() {
    this.output.gain.setTargetAtTime(0, this.audioContext.currentTime, 0.005);
  }

  connect(destination) {
    this.output.connect(destination);
  }

  disconnect() {
    this.output.disconnect();
  }

  process(results) {
    const { labels, smoothedNormalizedLikelihoods } = results;

    labels.forEach((label, index) => {
      const { env, hysteresis } = this.sources[label];
      const likelihood = smoothedNormalizedLikelihoods[index]
      const gain = hysteresis.process(likelihood);
      env.gain.setTargetAtTime(gain, this.audioContext.currentTime, 0.005);
    });
    // console.log(results);
  }
}

let parallelSynth = null;

export async function enter(context) {
  const { output, state, soundbank, scriptName } = context;

  labels = Object.keys(soundbank);
  model = await como.modelManager.getModel('test'); // session.id

  parallelSynth = new ParallelSynth(audioContext, soundbank, model);
  parallelSynth.connect(output);

  console.log(`> model "${model.state.get('id')}" loaded`, model.state.get('infos'));

  await state.set('labels', labels);
  // lazily create a shared model if it doesn't exists yet

  state.onUpdate(async updates => {
    for (let [key, value] of Object.entries(updates)) {
      switch (key) {
        case 'record': {
          // @todo - ack or refuse example
          if (Array.isArray(recordExample) && value === false) {
            const label = state.get('recordLabel');
            model.addExample(label, recordExample);
            recordExample = null;
          } else {
            recordExample = [];
          }
        }
        break;
      }
    }
  }, true);
}

export async function exit(context) {
  const { output, state, soundbank, scriptName } = context;
  console.log('xmm-test exit()');

  if (parallelSynth) {
    parallelSynth.disconnect();
    parallelSynth.delete();
  }
}

export async function process(context, frame) {
  const { output, state, soundbank, scriptName } = context;
  // console.log('xmm-test process()');
  let forceLabel = null;
  let results = null;

  // motion stream processsing and packing
  const xmmFrame = [
    frame[0].accelerometer.x,
    frame[0].accelerometer.y,
    frame[0].accelerometer.z,
  ];

  // handle preview, record and process logic
  if (state.get('record')) {
    forceLabel = state.get('recordLabel') || null;
    recordExample.push(xmmFrame);
  } else {
    results = model.process(xmmFrame);
  }
  // if preview is enabled, we still want to possibly record
  if (state.get('previewLabel')) {
    forceLabel = state.get('previewLabel') || null;
  }

  // audio synthesis
  if (forceLabel && forceLabel !== previewLabel) {
    previewLabel = forceLabel;
    parallelSynth.fadeOut();

    if (previewSource) {
      previewSource.stop();
      previewSource = null;
    }

    const buffer = soundbank[currentLabel];
    previewSource = new AudioBufferSourceNode(audioContext, { buffer, loop: true });
    previewSource.connect(output);
    previewSource.start();
  } else {
    previewLabel = null;
    parallelSynth.fadeIn();
    parallelSynth.process(results);
  }
}

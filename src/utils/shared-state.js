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

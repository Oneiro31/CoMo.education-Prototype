
# CoMo.education — Interactive Gesture-to-Sound Prototype

This repository contains a prototype of the **CoMo.education** application, developed using the [CoMo](https://github.com/ircam-ismm/como) and [Soundworks](https://soundworks.dev/) web frameworks.

The application allows users to record gesture examples, associate them with sounds, and recognize performed gestures in order to trigger the corresponding sounds. It is intended for experimenting with gesture-based and sound-based storytelling activities, particularly in educational contexts involving young children.

## Main Features

- selection of sounds from a soundbank;
- import of custom audio files;
- recording of gesture examples;
- testing and validation of a gesture before adding it to the model;
- gesture learning and recognition using XMM;
- local sound triggering and playback on the embedded device;
- sound level modulation according to movement intensity;
- deletion of individual examples or all recorded gestures;
- application control through a web interface.

## General Architecture

The application runs on two machines connected to the same local network:

- a computer running the Soundworks server and the `teacher` web interface;
- a device running the Node.js `device` client, such as a Raspberry Pi.

The `device` client receives the motion data, performs gesture recognition, and generates the sound. The `teacher` interface is used to configure the associations between gestures and sounds.

The application is primarily designed for use with an LSM9DS1 inertial sensor connected directly to a Raspberry Pi via I²C, but it can also be used with other sources of motion supported by the CoMo framework (e.g. CoMote and R-IoT)

## Requirements

### Software

- Node.js;
- npm;
- a web browser;

### Hardware

Assuming that the embedded device is the primary system used:

- a computer running the server and displaying the web interface;
- a Raspberry Pi running the `device` client;
- an LSM9DS1 inertial sensor;
- a battery and an audio playback system;

All machines must be connected to the same local network.


## Installation

Clone the repository:

```bash
git clone git@github.com:Oneiro31/CoMo.education---Prototype-.git
cd CoMo.education---Prototype-
```

Install the dependencies:

```bash
npm install
```


## Network Configuration

The main network configuration is located in:

```text
config/env-default.yaml
```

Set `serverAddress` to the IP address of the computer running the Soundworks server:

```yaml
type: development
port: 8000
serverAddress: '192.168.1.86'
useHttps: false

httpsInfos:
  cert: null
  key: null

baseUrl: ''

auth:
  clients: []
  login: ''
  password: ''
```

The address specified in `serverAddress` must be reachable from the machine running the server.

If the server IP address changes:

1. update the value of `serverAddress`;
2. restart the server;
3. restart the `device` client.




## Modify the LSM9DS1 source

The motion source used by the prototype is defined in:

```text
src/clients/device.js
```

The creation and modification parameters the LSM9DS1 source :

```js
  const lsm9ds1 = await como.sourceManager.createSource({
    type: 'lsm9ds1',
    id: '1',
    interval: 10,
    verbose: false,
});
```



## Running the Application

### 1. Start the Server

From the main computer, run:

```bash
npm run dev
```

This command builds the application, starts the Soundworks server, and watches the source files for changes.

### 2. Start the `device` Client

In a second terminal, on the machine receiving the motion data and generating the sound, run:

```bash
npm run watch device
```

When the client has started successfully, the terminal should display a message similar to:

```text
player "gesture-player" is running "gesture-sound.js"
```

### 3. Open the Web Interface

From a web browser connected to the same network, open:

```text
http://<server-address>:8000
```

For example:

```text
http://192.168.1.86:8000
```

Because the `teacher` client is defined as the default browser client, its interface is available at the root address of the application.


## Using the Interface

### Recording a Gesture

1. Select **Creation** mode.
2. Select a sound from the soundbank or import a custom audio file.
3. Enter a name for the gesture.
4. Click **Record**.
5. Wait for the end of the spoken countdown.
6. Perform the gesture during the four-second recording period.
7. Click **Test gesture**, then perform the movement again.
8. Click **Validate** to save the gesture or **Cancel** to discard it.

Several examples can be recorded to improve the learning of the same gesture.


### Recognizing Gestures

1. Record and validate at least one gesture example.
2. Select **Play** mode.
3. Perform one of the recorded gestures.
4. The XMM model recognizes the gesture and triggers its associated sound.

The intensity of the movement also controls the sound level.

### Importing a Sound

Drop one or more audio files into the import area of the interface.

The following formats are accepted:

- WAV;
- MP3;
- OGG;
- M4A;
- AAC;
- FLAC;
- AIF;
- AIFF.

Imported files are added to the list of available sounds and can then be associated with gestures.


### Deleting Items

The interface can be used to:

- delete an imported sound;
- delete an individual gesture example;
- discard a gesture before validation;
- delete all recorded gestures.



## Resources

- [CoMo framework](https://github.com/ircam-ismm/como)
- [Soundworks documentation](https://soundworks.dev/)
- [Soundworks API](https://soundworks.dev/api)


## Credits

This prototype was developed as part of the CoMo.education project within the ISMM team at Ircam.

[Soundworks](https://soundworks.dev/) and [CoMo](https://github.com/ircam-ismm/como) are developed by the ISMM team at Ircam.


## License

[BSD-3-Clause](./LICENSE)






import '@soundworks/helpers/polyfills.js';
import { Client } from '@soundworks/core/client.js';
import { loadConfig, launcher } from '@soundworks/helpers/node.js';



import ComoClient from '@ircam/como/ComoClient.js';


const OSC_PORT = 8001;
const APP_PLAYER_ID = 'gesture-player';
const APP_SCRIPT_NAME = 'gesture-sound.js';


async function bootstrap() {
  const config = loadConfig(process.env.ENV, import.meta.url);
  const client = new Client(config);

  launcher.register(client);


  const como = new ComoClient(client);
  await como.start();


  const comote = await como.sourceManager.createSource({
    type: 'comote',
    id: '0',
    port: OSC_PORT,
    verbose: false,
  });


  const playerId = como.playerManager.playerExists(APP_PLAYER_ID)
    ? APP_PLAYER_ID
    : await como.playerManager.createPlayer(comote, {
      id: APP_PLAYER_ID,
    });

  const player = await como.playerManager.getPlayer(playerId);


  /*const lsm9ds1 = await como.sourceManager.createSource({
    type: 'lsm9ds1',
    id: '1',
    interval: 10,
    verbose: false,
  });


  const playerId = como.playerManager.playerExists(APP_PLAYER_ID)
    ? APP_PLAYER_ID
    : await como.playerManager.createPlayer(lsm9ds1, {
      id: APP_PLAYER_ID,
    });

  const player = await como.playerManager.getPlayer(playerId);*/


  await player.state.set({
    sessionId: null,
  });

  await player.setScript(APP_SCRIPT_NAME);

  console.log(`player "${APP_PLAYER_ID}" is running "${APP_SCRIPT_NAME}"`);
}


launcher.execute(bootstrap, {
  numClients: process.env.EMULATE ? parseInt(process.env.EMULATE) : 1,
  moduleURL: import.meta.url,
});

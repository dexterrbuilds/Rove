import {createApp} from './app.js';
import {safeErrorMessage} from './utils.js';
import {validatePrivyStartupSecurity} from './privy-security.js';

const PORT = process.env.PORT || 3000;

async function start() {
  await validatePrivyStartupSecurity();
  createApp().listen(PORT, () => {
    console.log(`Rove API listening on port ${PORT}`);
  });
}

start().catch((error) => {
  console.error('Rove API refused to start:', safeErrorMessage(error));
  process.exitCode = 1;
});

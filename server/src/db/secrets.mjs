/** Generate the secrets a deployment needs. Nothing is stored; copy them out. */
import crypto from 'node:crypto';
const s = () => crypto.randomBytes(48).toString('base64url');
console.log(`
  Paste these into the host's environment. They are shown once.

  JWT_SECRET=${s()}
  JWT_REFRESH_SECRET=${s()}

  Then, for notifications:   npm run push:keys -w server
  And to check what is left: npm run preflight -w server
`);

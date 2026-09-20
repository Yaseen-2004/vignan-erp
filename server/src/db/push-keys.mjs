/**
 * Generate the VAPID pair once.
 *
 *   npm run push:keys -w server
 *
 * These are the server's own identity to the browsers' push services. There is
 * no account with anyone: the pair is the whole arrangement. Keep the private
 * key with the other secrets — anyone holding it can send notifications that
 * appear to come from the school.
 */
import webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log('\nAdd these to server/.env — the private key is a secret:\n');
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log('VAPID_SUBJECT=mailto:office@vignan.edu\n');
console.log('Then restart the API. Existing subscriptions are tied to the old');
console.log('key, so replacing the pair asks everyone to switch on again.\n');

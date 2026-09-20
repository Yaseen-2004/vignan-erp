/**
 * The in-portal user manual, in English and Kannada.
 *
 * Every string is a `{ en, kn }` pair so the reader can switch language — or
 * show both at once — without the manual being maintained twice. The figures
 * are schematic drawings (see `figures.jsx`), not screenshots, so they stay
 * correct in both light and dark themes and cost the bundle nothing.
 *
 * Shape:
 *   chapters[] → topics[] → steps[] (numbered against the figure callouts)
 *                        → notes[]  (tone: 'info' | 'tip' | 'warn' | 'rule')
 */

const t = (en, kn) => ({ en, kn });

/* ===================================================================== */
/*  CHAPTERS EVERY ROLE SHARES                                           */
/* ===================================================================== */

/** Signing in — identical for all six roles. */
const signingIn = (who) => ({
  id: 'signing-in',
  icon: 'lock',
  title: t('Signing in', 'ಲಾಗಿನ್ ಆಗುವುದು'),
  summary: t(
    `How to open the portal, sign in as ${who.en.toLowerCase()}, and what to do if you cannot get in.`,
    `ಪೋರ್ಟಲ್ ತೆರೆಯುವುದು, ${who.kn} ಆಗಿ ಲಾಗಿನ್ ಆಗುವುದು ಮತ್ತು ಲಾಗಿನ್ ಆಗಲು ಸಾಧ್ಯವಾಗದಿದ್ದರೆ ಏನು ಮಾಡಬೇಕು.`
  ),
  topics: [
    {
      title: t('Open the portal and sign in', 'ಪೋರ್ಟಲ್ ತೆರೆದು ಲಾಗಿನ್ ಆಗಿ'),
      figure: 'login',
      caption: t('The sign-in screen', 'ಲಾಗಿನ್ ಪರದೆ'),
      steps: [
        t(
          'Open the school portal address in your browser and type the username the school office gave you.',
          'ನಿಮ್ಮ ಬ್ರೌಸರ್‌ನಲ್ಲಿ ಶಾಲೆಯ ಪೋರ್ಟಲ್ ವಿಳಾಸವನ್ನು ತೆರೆದು, ಶಾಲಾ ಕಚೇರಿ ನೀಡಿದ ಬಳಕೆದಾರ ಹೆಸರನ್ನು ನಮೂದಿಸಿ.'
        ),
        t(
          'Type your password. Use the eye icon to check what you have typed before continuing.',
          'ನಿಮ್ಮ ಪಾಸ್‌ವರ್ಡ್ ನಮೂದಿಸಿ. ಮುಂದುವರಿಯುವ ಮೊದಲು ನೀವು ಟೈಪ್ ಮಾಡಿದ್ದನ್ನು ಪರಿಶೀಲಿಸಲು ಕಣ್ಣಿನ ಚಿಹ್ನೆಯನ್ನು ಬಳಸಿ.'
        ),
        t(
          'Click Sign in. The portal opens on your own dashboard — you only ever see the section that belongs to your role.',
          'ಸೈನ್ ಇನ್ ಕ್ಲಿಕ್ ಮಾಡಿ. ಪೋರ್ಟಲ್ ನಿಮ್ಮದೇ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್‌ನಲ್ಲಿ ತೆರೆಯುತ್ತದೆ — ನಿಮ್ಮ ಪಾತ್ರಕ್ಕೆ ಸೇರಿದ ವಿಭಾಗವನ್ನು ಮಾತ್ರ ನೀವು ನೋಡುತ್ತೀರಿ.'
        ),
      ],
      notes: [
        {
          tone: 'rule',
          title: t('Never share your password', 'ನಿಮ್ಮ ಪಾಸ್‌ವರ್ಡ್ ಅನ್ನು ಎಂದಿಗೂ ಹಂಚಿಕೊಳ್ಳಬೇಡಿ'),
          body: t(
            'Every action you take is recorded against your account in the audit log, with the old and new values. If someone else uses your login, it will be recorded as if you did it.',
            'ನೀವು ಮಾಡುವ ಪ್ರತಿಯೊಂದು ಕ್ರಿಯೆಯೂ ಹಳೆಯ ಮತ್ತು ಹೊಸ ಮೌಲ್ಯಗಳ ಸಹಿತ ನಿಮ್ಮ ಖಾತೆಯ ಹೆಸರಿನಲ್ಲಿ ಲೆಕ್ಕಪರಿಶೋಧನಾ ದಾಖಲೆಯಲ್ಲಿ ದಾಖಲಾಗುತ್ತದೆ. ಬೇರೆಯವರು ನಿಮ್ಮ ಲಾಗಿನ್ ಬಳಸಿದರೆ, ಅದನ್ನು ನೀವೇ ಮಾಡಿದಂತೆ ದಾಖಲಿಸಲಾಗುತ್ತದೆ.'
          ),
        },
        {
          tone: 'tip',
          title: t('Forgotten your password?', 'ಪಾಸ್‌ವರ್ಡ್ ಮರೆತಿರಾ?'),
          body: t(
            'Click "Forgot your password?" below the sign-in button, give your username and a telephone number, and send the request. The school office will identify you and hand over a temporary password, which you must change the moment you sign in.',
            'ಸೈನ್ ಇನ್ ಬಟನ್‌ನ ಕೆಳಗಿರುವ "ಪಾಸ್‌ವರ್ಡ್ ಮರೆತಿರಾ?" ಕ್ಲಿಕ್ ಮಾಡಿ, ನಿಮ್ಮ ಬಳಕೆದಾರ ಹೆಸರು ಮತ್ತು ದೂರವಾಣಿ ಸಂಖ್ಯೆ ನೀಡಿ ಅರ್ಜಿ ಕಳುಹಿಸಿ. ಶಾಲಾ ಕಚೇರಿಯವರು ನಿಮ್ಮನ್ನು ಗುರುತಿಸಿ ತಾತ್ಕಾಲಿಕ ಪಾಸ್‌ವರ್ಡ್ ನೀಡುತ್ತಾರೆ; ಲಾಗಿನ್ ಆದ ಕೂಡಲೇ ಅದನ್ನು ನೀವು ಬದಲಾಯಿಸಬೇಕು.'
          ),
        },
      ],
    },
    {
      title: t('If you cannot sign in', 'ಲಾಗಿನ್ ಆಗಲು ಸಾಧ್ಯವಾಗದಿದ್ದರೆ'),
      figure: 'form',
      caption: t('The password reset request', 'ಪಾಸ್‌ವರ್ಡ್ ಮರುಹೊಂದಿಕೆ ಅರ್ಜಿ'),
      steps: [
        t(
          'Click "Forgot your password?" beneath the sign-in button and type the username or email of the account you cannot get into.',
          'ಸೈನ್ ಇನ್ ಬಟನ್‌ನ ಕೆಳಗಿರುವ "ಪಾಸ್‌ವರ್ಡ್ ಮರೆತಿರಾ?" ಕ್ಲಿಕ್ ಮಾಡಿ, ನೀವು ಪ್ರವೇಶಿಸಲಾಗದ ಖಾತೆಯ ಬಳಕೆದಾರ ಹೆಸರು ಅಥವಾ ಇಮೇಲ್ ನಮೂದಿಸಿ.'
        ),
        t(
          'Give a telephone number the office can reach you on, so they can confirm it is really you.',
          'ಕಚೇರಿಯವರು ನಿಮ್ಮನ್ನು ಸಂಪರ್ಕಿಸಬಹುದಾದ ದೂರವಾಣಿ ಸಂಖ್ಯೆ ನೀಡಿ, ಇದರಿಂದ ಅವರು ನೀವೇ ಎಂದು ಖಚಿತಪಡಿಸಿಕೊಳ್ಳಬಹುದು.'
        ),
        t(
          'Send the request. It reaches the school office at once; visit or telephone them to collect your temporary password.',
          'ಅರ್ಜಿ ಕಳುಹಿಸಿ. ಅದು ತಕ್ಷಣ ಶಾಲಾ ಕಚೇರಿಗೆ ತಲುಪುತ್ತದೆ; ತಾತ್ಕಾಲಿಕ ಪಾಸ್‌ವರ್ಡ್ ಪಡೆಯಲು ಅಲ್ಲಿಗೆ ಹೋಗಿ ಅಥವಾ ದೂರವಾಣಿ ಮಾಡಿ.'
        ),
        t(
          'Sign in with the temporary password. You will be asked at once to choose a new one of your own.',
          'ತಾತ್ಕಾಲಿಕ ಪಾಸ್‌ವರ್ಡ್‌ನಿಂದ ಲಾಗಿನ್ ಆಗಿ. ತಕ್ಷಣವೇ ನಿಮ್ಮದೇ ಹೊಸ ಪಾಸ್‌ವರ್ಡ್ ಆಯ್ಕೆ ಮಾಡಲು ಕೇಳಲಾಗುತ್ತದೆ.'
        ),
      ],
      notes: [
        {
          tone: 'info',
          title: t('No reset link is emailed', 'ಮರುಹೊಂದಿಕೆ ಕೊಂಡಿ ಇಮೇಲ್ ಮಾಡಲಾಗುವುದಿಲ್ಲ'),
          body: t(
            'The school issues the password in person so that nobody can take over an account from a stolen email inbox.',
            'ಕದ್ದ ಇಮೇಲ್ ಖಾತೆಯಿಂದ ಯಾರೂ ಬೇರೊಬ್ಬರ ಖಾತೆಯನ್ನು ವಶಪಡಿಸಿಕೊಳ್ಳದಂತೆ ಶಾಲೆಯು ಪಾಸ್‌ವರ್ಡ್ ಅನ್ನು ಖುದ್ದಾಗಿ ನೀಡುತ್ತದೆ.'
          ),
        },
      ],
    },
    {
      title: t('Finding your way around', 'ಪರದೆಯ ಪರಿಚಯ'),
      figure: 'shell',
      caption: t('The parts of every screen', 'ಪ್ರತಿ ಪರದೆಯ ಭಾಗಗಳು'),
      steps: [
        t(
          'The dark menu on the left lists everything you are allowed to open. On a phone, tap the ☰ button to show it.',
          'ಎಡಭಾಗದ ಗಾಢ ಮೆನುವಿನಲ್ಲಿ ನೀವು ತೆರೆಯಬಹುದಾದ ಎಲ್ಲವೂ ಇರುತ್ತದೆ. ಮೊಬೈಲ್‌ನಲ್ಲಿ ಅದನ್ನು ತೋರಿಸಲು ☰ ಬಟನ್ ಒತ್ತಿ.'
        ),
        t(
          'The search box at the top finds records quickly without opening each page.',
          'ಮೇಲಿನ ಹುಡುಕಾಟ ಪೆಟ್ಟಿಗೆಯು ಪ್ರತಿ ಪುಟವನ್ನು ತೆರೆಯದೆಯೇ ದಾಖಲೆಗಳನ್ನು ಬೇಗನೆ ಹುಡುಕುತ್ತದೆ.'
        ),
        t(
          'The bell shows new notifications, and your photograph opens the menu with My Profile, Change Password and Sign out.',
          'ಗಂಟೆಯ ಚಿಹ್ನೆ ಹೊಸ ಸೂಚನೆಗಳನ್ನು ತೋರಿಸುತ್ತದೆ; ನಿಮ್ಮ ಫೋಟೋ ಕ್ಲಿಕ್ ಮಾಡಿದರೆ ನನ್ನ ಪ್ರೊಫೈಲ್, ಪಾಸ್‌ವರ್ಡ್ ಬದಲಾಯಿಸಿ ಮತ್ತು ಸೈನ್ ಔಟ್ ಮೆನು ತೆರೆಯುತ್ತದೆ.'
        ),
        t(
          'The tiles across the top of a dashboard are a summary; click any tile to open the full list behind it.',
          'ಡ್ಯಾಶ್‌ಬೋರ್ಡ್‌ನ ಮೇಲಿನ ಚೌಕಗಳು ಸಾರಾಂಶವಾಗಿವೆ; ಪೂರ್ಣ ಪಟ್ಟಿ ತೆರೆಯಲು ಯಾವುದೇ ಚೌಕವನ್ನು ಕ್ಲಿಕ್ ಮಾಡಿ.'
        ),
      ],
      notes: [
        {
          tone: 'info',
          title: t('If a menu item is missing', 'ಮೆನು ಐಟಂ ಕಾಣಿಸದಿದ್ದರೆ'),
          body: t(
            'The menu only shows what your role is permitted to use. If something you need is missing, ask the Admin to grant the permission — it is not a fault.',
            'ನಿಮ್ಮ ಪಾತ್ರಕ್ಕೆ ಅನುಮತಿ ಇರುವುದನ್ನು ಮಾತ್ರ ಮೆನು ತೋರಿಸುತ್ತದೆ. ನಿಮಗೆ ಬೇಕಾದದ್ದು ಕಾಣಿಸದಿದ್ದರೆ, ಅನುಮತಿ ನೀಡುವಂತೆ ಅಡ್ಮಿನ್‌ರನ್ನು ಕೇಳಿ — ಇದು ದೋಷವಲ್ಲ.'
          ),
        },
      ],
    },
  ],
});

/** Messages, notices and leave — shared by staff, students and parents. */
const stayingInTouch = (opts = {}) => ({
  id: 'staying-in-touch',
  icon: 'mail',
  title: t('Messages, notices and leave', 'ಸಂದೇಶ, ಸೂಚನೆ ಮತ್ತು ರಜೆ'),
  summary: t(
    'Reading what the school sends you, writing to the school, and applying for leave.',
    'ಶಾಲೆ ಕಳುಹಿಸುವುದನ್ನು ಓದುವುದು, ಶಾಲೆಗೆ ಬರೆಯುವುದು ಮತ್ತು ರಜೆಗೆ ಅರ್ಜಿ ಸಲ್ಲಿಸುವುದು.'
  ),
  topics: [
    {
      title: t('Notifications and messages', 'ಸೂಚನೆಗಳು ಮತ್ತು ಸಂದೇಶಗಳು'),
      figure: 'materials',
      caption: t('The message list', 'ಸಂದೇಶಗಳ ಪಟ್ಟಿ'),
      steps: [
        t(
          'Open Messages from the menu. Unread items are shown in bold at the top.',
          'ಮೆನುವಿನಿಂದ ಸಂದೇಶಗಳನ್ನು ತೆರೆಯಿರಿ. ಓದದ ಸಂದೇಶಗಳು ಮೇಲ್ಭಾಗದಲ್ಲಿ ದಪ್ಪ ಅಕ್ಷರದಲ್ಲಿ ಕಾಣಿಸುತ್ತವೆ.'
        ),
        t(
          'Click New message, choose the person, type a subject and your message, then send.',
          'ಹೊಸ ಸಂದೇಶ ಕ್ಲಿಕ್ ಮಾಡಿ, ವ್ಯಕ್ತಿಯನ್ನು ಆಯ್ಕೆ ಮಾಡಿ, ವಿಷಯ ಮತ್ತು ಸಂದೇಶವನ್ನು ಬರೆದು ಕಳುಹಿಸಿ.'
        ),
        t(
          'The bell icon in the header lists notifications — attendance, results, fees and circulars all appear there.',
          'ಹೆಡರ್‌ನಲ್ಲಿರುವ ಗಂಟೆಯ ಚಿಹ್ನೆ ಸೂಚನೆಗಳನ್ನು ತೋರಿಸುತ್ತದೆ — ಹಾಜರಾತಿ, ಫಲಿತಾಂಶ, ಶುಲ್ಕ ಮತ್ತು ಸುತ್ತೋಲೆಗಳು ಅಲ್ಲಿ ಕಾಣಿಸುತ್ತವೆ.'
        ),
        t(
          'Notices and announcements published by the school appear on your dashboard as well as on their own pages.',
          'ಶಾಲೆ ಪ್ರಕಟಿಸಿದ ಸೂಚನೆಗಳು ಮತ್ತು ಪ್ರಕಟಣೆಗಳು ಅವುಗಳ ಪುಟಗಳಲ್ಲಿ ಮತ್ತು ನಿಮ್ಮ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್‌ನಲ್ಲಿಯೂ ಕಾಣಿಸುತ್ತವೆ.'
        ),
      ],
    },
    {
      title: opts.leaveTitle || t('Applying for leave', 'ರಜೆಗೆ ಅರ್ಜಿ ಸಲ್ಲಿಸುವುದು'),
      figure: 'form',
      caption: t('The leave request form', 'ರಜೆ ಅರ್ಜಿ ನಮೂನೆ'),
      steps: [
        t('Open Leave from the menu and click Apply for leave.', 'ಮೆನುವಿನಿಂದ ರಜೆ ತೆರೆದು, ರಜೆಗೆ ಅರ್ಜಿ ಸಲ್ಲಿಸಿ ಕ್ಲಿಕ್ ಮಾಡಿ.'),
        t(
          'Choose the leave type and the from and to dates, and write the reason.',
          'ರಜೆಯ ಪ್ರಕಾರ, ಪ್ರಾರಂಭ ಮತ್ತು ಅಂತಿಮ ದಿನಾಂಕಗಳನ್ನು ಆಯ್ಕೆ ಮಾಡಿ ಹಾಗೂ ಕಾರಣವನ್ನು ಬರೆಯಿರಿ.'
        ),
        t(
          'Submit. The status shows PENDING until it is approved or rejected, and you are notified of the decision.',
          'ಸಲ್ಲಿಸಿ. ಅನುಮೋದನೆ ಅಥವಾ ತಿರಸ್ಕಾರವಾಗುವವರೆಗೆ ಸ್ಥಿತಿ ಬಾಕಿ (PENDING) ಎಂದು ತೋರಿಸುತ್ತದೆ; ನಿರ್ಧಾರವನ್ನು ನಿಮಗೆ ತಿಳಿಸಲಾಗುತ್ತದೆ.'
        ),
        t(
          'Close the dialog to return to the list; a request that has been approved can no longer be edited.',
          'ಪಟ್ಟಿಗೆ ಮರಳಲು ಸಂವಾದ ಪೆಟ್ಟಿಗೆಯನ್ನು ಮುಚ್ಚಿ; ಅನುಮೋದನೆಗೊಂಡ ಅರ್ಜಿಯನ್ನು ಮತ್ತೆ ತಿದ್ದಲಾಗದು.'
        ),
      ],
    },
  ],
});

/** Changing your password — everyone. */
const accountChapter = {
  id: 'your-account',
  icon: 'user',
  title: t('Your account', 'ನಿಮ್ಮ ಖಾತೆ'),
  summary: t(
    'Keeping your own details and password up to date.',
    'ನಿಮ್ಮ ವಿವರಗಳು ಮತ್ತು ಪಾಸ್‌ವರ್ಡ್ ಅನ್ನು ನವೀಕೃತವಾಗಿಡುವುದು.'
  ),
  topics: [
    {
      title: t('Profile and password', 'ಪ್ರೊಫೈಲ್ ಮತ್ತು ಪಾಸ್‌ವರ್ಡ್'),
      figure: 'form',
      caption: t('Change password', 'ಪಾಸ್‌ವರ್ಡ್ ಬದಲಾಯಿಸಿ'),
      steps: [
        t(
          'Click your photograph at the top right and choose My Profile to see the details the school holds for you.',
          'ಮೇಲಿನ ಬಲಭಾಗದಲ್ಲಿರುವ ನಿಮ್ಮ ಫೋಟೋ ಕ್ಲಿಕ್ ಮಾಡಿ, ಶಾಲೆಯಲ್ಲಿ ನಿಮ್ಮ ಬಗ್ಗೆ ಇರುವ ವಿವರಗಳನ್ನು ನೋಡಲು ನನ್ನ ಪ್ರೊಫೈಲ್ ಆಯ್ಕೆ ಮಾಡಿ.'
        ),
        t(
          'Choose Change Password, type your current password and then the new one twice.',
          'ಪಾಸ್‌ವರ್ಡ್ ಬದಲಾಯಿಸಿ ಆಯ್ಕೆ ಮಾಡಿ, ಈಗಿನ ಪಾಸ್‌ವರ್ಡ್ ನಂತರ ಹೊಸದನ್ನು ಎರಡು ಬಾರಿ ನಮೂದಿಸಿ.'
        ),
        t(
          'Save. You stay signed in on this device; other devices will ask you to sign in again.',
          'ಉಳಿಸಿ. ಈ ಸಾಧನದಲ್ಲಿ ನೀವು ಸೈನ್ ಇನ್ ಆಗಿಯೇ ಇರುತ್ತೀರಿ; ಇತರ ಸಾಧನಗಳಲ್ಲಿ ಮತ್ತೆ ಲಾಗಿನ್ ಕೇಳಲಾಗುತ್ತದೆ.'
        ),
        t(
          'If a detail such as your telephone number is wrong, ask the school office to correct it.',
          'ದೂರವಾಣಿ ಸಂಖ್ಯೆಯಂತಹ ವಿವರ ತಪ್ಪಾಗಿದ್ದರೆ, ಸರಿಪಡಿಸುವಂತೆ ಶಾಲಾ ಕಚೇರಿಯನ್ನು ಕೇಳಿ.'
        ),
      ],
      notes: [
        {
          tone: 'warn',
          title: t('Always sign out on a shared computer', 'ಸಾಮಾನ್ಯ ಕಂಪ್ಯೂಟರ್‌ನಲ್ಲಿ ಯಾವಾಗಲೂ ಸೈನ್ ಔಟ್ ಮಾಡಿ'),
          body: t(
            'Use Sign out rather than simply closing the browser window.',
            'ಬ್ರೌಸರ್ ವಿಂಡೋವನ್ನು ಮುಚ್ಚುವ ಬದಲು ಸೈನ್ ಔಟ್ ಬಳಸಿ.'
          ),
        },
      ],
    },
  ],
};

/* ===================================================================== */
/*  ADMINISTRATOR                                                        */
/* ===================================================================== */

const ADMINISTRATOR = {
  role: t('Administrator', 'ಆಡಳಿತಾಧಿಕಾರಿ'),
  subtitle: t('Student & Faculty Management', 'ವಿದ್ಯಾರ್ಥಿ ಮತ್ತು ಸಿಬ್ಬಂದಿ ನಿರ್ವಹಣೆ'),
  intro: t(
    'You manage admissions, enrolment, classes, staff records, examinations and school-wide communication, across both the State Board and CBSE departments. You cannot change system settings, roles or permissions — those belong to the Admin.',
    'ರಾಜ್ಯ ಪಠ್ಯಕ್ರಮ ಮತ್ತು ಸಿಬಿಎಸ್‌ಇ ಎರಡೂ ವಿಭಾಗಗಳಲ್ಲಿ ಪ್ರವೇಶ, ದಾಖಲಾತಿ, ತರಗತಿಗಳು, ಸಿಬ್ಬಂದಿ ದಾಖಲೆಗಳು, ಪರೀಕ್ಷೆಗಳು ಮತ್ತು ಶಾಲಾ ಸಂವಹನವನ್ನು ನೀವು ನಿರ್ವಹಿಸುತ್ತೀರಿ. ವ್ಯವಸ್ಥೆಯ ಸೆಟ್ಟಿಂಗ್‌ಗಳು, ಪಾತ್ರಗಳು ಅಥವಾ ಅನುಮತಿಗಳನ್ನು ನೀವು ಬದಲಾಯಿಸಲಾಗದು — ಅವು ಅಡ್ಮಿನ್‌ಗೆ ಸೇರಿವೆ.'
  ),
  chapters: [
    signingIn(t('an Administrator', 'ಆಡಳಿತಾಧಿಕಾರಿ')),
    {
      id: 'departments',
      icon: 'grid',
      title: t('Choosing the department', 'ವಿಭಾಗವನ್ನು ಆಯ್ಕೆ ಮಾಡುವುದು'),
      summary: t(
        'The school runs two departments — State Board and CBSE. You have full access to both and choose which one you are working in.',
        'ಶಾಲೆಯಲ್ಲಿ ಎರಡು ವಿಭಾಗಗಳಿವೆ — ರಾಜ್ಯ ಪಠ್ಯಕ್ರಮ ಮತ್ತು ಸಿಬಿಎಸ್‌ಇ. ಎರಡಕ್ಕೂ ನಿಮಗೆ ಪೂರ್ಣ ಪ್ರವೇಶವಿದ್ದು, ಯಾವುದರಲ್ಲಿ ಕೆಲಸ ಮಾಡುತ್ತಿದ್ದೀರಿ ಎಂಬುದನ್ನು ನೀವು ಆಯ್ಕೆ ಮಾಡುತ್ತೀರಿ.'
      ),
      topics: [
        {
          title: t('Switching between State Board and CBSE', 'ರಾಜ್ಯ ಪಠ್ಯಕ್ರಮ ಮತ್ತು ಸಿಬಿಎಸ್‌ಇ ನಡುವೆ ಬದಲಾಯಿಸುವುದು'),
          figure: 'shell',
          caption: t('The department selector in the header', 'ಹೆಡರ್‌ನಲ್ಲಿರುವ ವಿಭಾಗ ಆಯ್ಕೆ'),
          steps: [
            t(
              'Use the department selector at the top of the screen to choose All departments, State Board or CBSE.',
              'ಪರದೆಯ ಮೇಲ್ಭಾಗದಲ್ಲಿರುವ ವಿಭಾಗ ಆಯ್ಕೆಯಿಂದ ಎಲ್ಲಾ ವಿಭಾಗಗಳು, ರಾಜ್ಯ ಪಠ್ಯಕ್ರಮ ಅಥವಾ ಸಿಬಿಎಸ್‌ಇ ಆಯ್ಕೆ ಮಾಡಿ.'
            ),
            t(
              'Every list — students, classes, faculty, results, fees — is then filtered to that department until you change it back.',
              'ನೀವು ಬದಲಾಯಿಸುವವರೆಗೆ ವಿದ್ಯಾರ್ಥಿಗಳು, ತರಗತಿಗಳು, ಸಿಬ್ಬಂದಿ, ಫಲಿತಾಂಶ, ಶುಲ್ಕ — ಪ್ರತಿ ಪಟ್ಟಿಯೂ ಆ ವಿಭಾಗಕ್ಕೆ ಸೀಮಿತವಾಗುತ್ತದೆ.'
            ),
            t(
              'Open Departments from the menu to see both wings side by side with their classes and strength.',
              'ಎರಡೂ ವಿಭಾಗಗಳನ್ನು ಅವುಗಳ ತರಗತಿ ಮತ್ತು ವಿದ್ಯಾರ್ಥಿ ಸಂಖ್ಯೆಯೊಂದಿಗೆ ಒಟ್ಟಿಗೆ ನೋಡಲು ಮೆನುವಿನಿಂದ ವಿಭಾಗಗಳನ್ನು ತೆರೆಯಿರಿ.'
            ),
            t(
              'The State Board wing runs Class 1 to 10; the CBSE wing runs Class 1 to 12, with a Science stream in Classes 11 and 12.',
              'ರಾಜ್ಯ ಪಠ್ಯಕ್ರಮ ವಿಭಾಗದಲ್ಲಿ 1ರಿಂದ 10ನೇ ತರಗತಿ; ಸಿಬಿಎಸ್‌ಇ ವಿಭಾಗದಲ್ಲಿ 1ರಿಂದ 12ನೇ ತರಗತಿ ಇದ್ದು, 11 ಮತ್ತು 12ನೇ ತರಗತಿಗಳಲ್ಲಿ ವಿಜ್ಞಾನ ವಿಭಾಗವಿದೆ.'
            ),
          ],
          notes: [
            {
              tone: 'tip',
              title: t('Set it before you start', 'ಆರಂಭಿಸುವ ಮೊದಲು ಆಯ್ಕೆ ಮಾಡಿ'),
              body: t(
                'Choosing the department first saves filtering every list afterwards, and prevents a record being created in the wrong wing.',
                'ಮೊದಲೇ ವಿಭಾಗವನ್ನು ಆಯ್ಕೆ ಮಾಡಿದರೆ ಪ್ರತಿ ಪಟ್ಟಿಯನ್ನು ಶೋಧಿಸುವ ಶ್ರಮ ಉಳಿಯುತ್ತದೆ ಮತ್ತು ತಪ್ಪು ವಿಭಾಗದಲ್ಲಿ ದಾಖಲೆ ಸೃಷ್ಟಿಯಾಗುವುದು ತಪ್ಪುತ್ತದೆ.'
              ),
            },
          ],
        },
      ],
    },
    {
      id: 'admissions',
      icon: 'user-plus',
      title: t('Admissions and student records', 'ಪ್ರವೇಶ ಮತ್ತು ವಿದ್ಯಾರ್ಥಿ ದಾಖಲೆಗಳು'),
      summary: t(
        'Admitting a new student, keeping the record correct, and promoting students at the end of the year.',
        'ಹೊಸ ವಿದ್ಯಾರ್ಥಿಯ ಪ್ರವೇಶ, ದಾಖಲೆಯನ್ನು ಸರಿಯಾಗಿಡುವುದು ಮತ್ತು ವರ್ಷಾಂತ್ಯದಲ್ಲಿ ಬಡ್ತಿ ನೀಡುವುದು.'
      ),
      topics: [
        {
          title: t('Admitting a new student', 'ಹೊಸ ವಿದ್ಯಾರ್ಥಿಯ ಪ್ರವೇಶ'),
          figure: 'form',
          caption: t('The admission form', 'ಪ್ರವೇಶ ನಮೂನೆ'),
          steps: [
            t(
              'Open Student Admission and fill the pupil’s name, date of birth, gender and the department they are joining.',
              'ವಿದ್ಯಾರ್ಥಿ ಪ್ರವೇಶ ತೆರೆದು, ಮಗುವಿನ ಹೆಸರು, ಜನ್ಮ ದಿನಾಂಕ, ಲಿಂಗ ಮತ್ತು ಸೇರುತ್ತಿರುವ ವಿಭಾಗವನ್ನು ಭರ್ತಿ ಮಾಡಿ.'
            ),
            t(
              'Choose the class and section, then enter the parent or guardian’s name, telephone number and address.',
              'ತರಗತಿ ಮತ್ತು ವಿಭಾಗ ಆಯ್ಕೆ ಮಾಡಿ, ನಂತರ ಪೋಷಕರ ಹೆಸರು, ದೂರವಾಣಿ ಸಂಖ್ಯೆ ಮತ್ತು ವಿಳಾಸವನ್ನು ನಮೂದಿಸಿ.'
            ),
            t(
              'Save. The admission number is generated automatically, and portal logins are created for both the student and the parent.',
              'ಉಳಿಸಿ. ಪ್ರವೇಶ ಸಂಖ್ಯೆ ತಾನಾಗಿಯೇ ಸೃಷ್ಟಿಯಾಗುತ್ತದೆ ಮತ್ತು ವಿದ್ಯಾರ್ಥಿ ಹಾಗೂ ಪೋಷಕರಿಬ್ಬರಿಗೂ ಪೋರ್ಟಲ್ ಲಾಗಿನ್ ಸೃಷ್ಟಿಯಾಗುತ್ತದೆ.'
            ),
            t(
              'Use the ✕ to close without saving if you opened the form by mistake — nothing is stored until you save.',
              'ಆಕಸ್ಮಿಕವಾಗಿ ನಮೂನೆ ತೆರೆದಿದ್ದರೆ ಉಳಿಸದೆ ಮುಚ್ಚಲು ✕ ಬಳಸಿ — ಉಳಿಸುವವರೆಗೆ ಏನೂ ಸಂಗ್ರಹವಾಗುವುದಿಲ್ಲ.'
            ),
          ],
          notes: [
            {
              tone: 'warn',
              title: t('Upload the documents', 'ದಾಖಲೆಗಳನ್ನು ಅಪ್‌ಲೋಡ್ ಮಾಡಿ'),
              body: t(
                'After admission, open Student Documents and attach the transfer certificate, birth certificate and photograph so the record is complete.',
                'ಪ್ರವೇಶದ ನಂತರ, ವಿದ್ಯಾರ್ಥಿ ದಾಖಲೆಗಳನ್ನು ತೆರೆದು ವರ್ಗಾವಣೆ ಪ್ರಮಾಣಪತ್ರ, ಜನನ ಪ್ರಮಾಣಪತ್ರ ಮತ್ತು ಫೋಟೋವನ್ನು ಲಗತ್ತಿಸಿ.'
              ),
            },
          ],
        },
        {
          title: t('Finding and editing a student', 'ವಿದ್ಯಾರ್ಥಿಯನ್ನು ಹುಡುಕುವುದು ಮತ್ತು ತಿದ್ದುವುದು'),
          figure: 'list',
          caption: t('The student list', 'ವಿದ್ಯಾರ್ಥಿಗಳ ಪಟ್ಟಿ'),
          steps: [
            t('Use Add to create a record, or find an existing one below.', 'ದಾಖಲೆ ಸೃಷ್ಟಿಸಲು ಸೇರಿಸಿ ಬಳಸಿ, ಅಥವಾ ಈಗಿರುವ ದಾಖಲೆಯನ್ನು ಕೆಳಗೆ ಹುಡುಕಿ.'),
            t(
              'Type a name or admission number in the search box; the list narrows as you type.',
              'ಹುಡುಕಾಟ ಪೆಟ್ಟಿಗೆಯಲ್ಲಿ ಹೆಸರು ಅಥವಾ ಪ್ರವೇಶ ಸಂಖ್ಯೆ ಟೈಪ್ ಮಾಡಿ; ಟೈಪ್ ಮಾಡುತ್ತಿದ್ದಂತೆ ಪಟ್ಟಿ ಕಿರಿದಾಗುತ್ತದೆ.'
            ),
            t(
              'Narrow further by class, section or status using the filters beside the search box.',
              'ಹುಡುಕಾಟ ಪೆಟ್ಟಿಗೆಯ ಪಕ್ಕದ ಶೋಧಕಗಳಿಂದ ತರಗತಿ, ವಿಭಾಗ ಅಥವಾ ಸ್ಥಿತಿಯ ಪ್ರಕಾರ ಇನ್ನಷ್ಟು ಕಿರಿದಾಗಿಸಿ.'
            ),
            t(
              'Use View to open the full profile, or Edit to correct a detail. Every change is written to the audit log.',
              'ಪೂರ್ಣ ಪ್ರೊಫೈಲ್ ತೆರೆಯಲು ವೀಕ್ಷಿಸಿ, ವಿವರ ಸರಿಪಡಿಸಲು ತಿದ್ದಿ ಬಳಸಿ. ಪ್ರತಿ ಬದಲಾವಣೆಯೂ ಲೆಕ್ಕಪರಿಶೋಧನಾ ದಾಖಲೆಯಲ್ಲಿ ದಾಖಲಾಗುತ್ತದೆ.'
            ),
          ],
        },
        {
          title: t('Promoting students to the next class', 'ಮುಂದಿನ ತರಗತಿಗೆ ಬಡ್ತಿ ನೀಡುವುದು'),
          figure: 'list',
          caption: t('Student promotion', 'ವಿದ್ಯಾರ್ಥಿ ಬಡ್ತಿ'),
          steps: [
            t('Open Student Promotion and choose the academic year that is ending.', 'ವಿದ್ಯಾರ್ಥಿ ಬಡ್ತಿ ತೆರೆದು, ಮುಗಿಯುತ್ತಿರುವ ಶೈಕ್ಷಣಿಕ ವರ್ಷವನ್ನು ಆಯ್ಕೆ ಮಾಡಿ.'),
            t('Choose the class and section you are promoting from, and the class they move to.', 'ಯಾವ ತರಗತಿ ಮತ್ತು ವಿಭಾಗದಿಂದ ಬಡ್ತಿ ನೀಡುತ್ತಿದ್ದೀರಿ ಹಾಗೂ ಯಾವ ತರಗತಿಗೆ ಎಂಬುದನ್ನು ಆಯ್ಕೆ ಮಾಡಿ.'),
            t(
              'Tick the students to promote. Those who have not passed can be left unticked and detained.',
              'ಬಡ್ತಿ ನೀಡಬೇಕಾದ ವಿದ್ಯಾರ್ಥಿಗಳನ್ನು ಗುರುತಿಸಿ. ಉತ್ತೀರ್ಣರಾಗದವರನ್ನು ಗುರುತಿಸದೆ ಬಿಡಬಹುದು.'
            ),
            t('Confirm. New enrolment records are created for the coming year.', 'ದೃಢೀಕರಿಸಿ. ಮುಂಬರುವ ವರ್ಷಕ್ಕೆ ಹೊಸ ದಾಖಲಾತಿ ದಾಖಲೆಗಳು ಸೃಷ್ಟಿಯಾಗುತ್ತವೆ.'),
          ],
          notes: [
            {
              tone: 'rule',
              title: t('The pass rule', 'ಉತ್ತೀರ್ಣ ನಿಯಮ'),
              body: t(
                'A student with an aggregate of 35% or more is marked PASS. Check the results before promoting.',
                'ಒಟ್ಟಾರೆ 35% ಅಥವಾ ಹೆಚ್ಚು ಅಂಕ ಪಡೆದ ವಿದ್ಯಾರ್ಥಿಯನ್ನು ಉತ್ತೀರ್ಣ ಎಂದು ಗುರುತಿಸಲಾಗುತ್ತದೆ. ಬಡ್ತಿ ನೀಡುವ ಮೊದಲು ಫಲಿತಾಂಶ ಪರಿಶೀಲಿಸಿ.'
              ),
            },
          ],
        },
      ],
    },
    {
      id: 'academics-setup',
      icon: 'layers',
      title: t('Classes, courses and staff', 'ತರಗತಿ, ಕೋರ್ಸ್ ಮತ್ತು ಸಿಬ್ಬಂದಿ'),
      summary: t(
        'Setting up the academic year and deciding which teacher takes which subject.',
        'ಶೈಕ್ಷಣಿಕ ವರ್ಷವನ್ನು ಸಿದ್ಧಪಡಿಸುವುದು ಮತ್ತು ಯಾವ ಶಿಕ್ಷಕರು ಯಾವ ವಿಷಯ ಬೋಧಿಸುತ್ತಾರೆ ಎಂದು ನಿರ್ಧರಿಸುವುದು.'
      ),
      topics: [
        {
          title: t('Academic year, classes and sections', 'ಶೈಕ್ಷಣಿಕ ವರ್ಷ, ತರಗತಿ ಮತ್ತು ವಿಭಾಗ'),
          figure: 'list',
          caption: t('Classes list', 'ತರಗತಿಗಳ ಪಟ್ಟಿ'),
          steps: [
            t(
              'Create the academic year first, from Academics → Academic Year, and mark it current.',
              'ಮೊದಲು ಶೈಕ್ಷಣಿಕ → ಶೈಕ್ಷಣಿಕ ವರ್ಷದಿಂದ ವರ್ಷವನ್ನು ಸೃಷ್ಟಿಸಿ ಮತ್ತು ಪ್ರಸ್ತುತ ಎಂದು ಗುರುತಿಸಿ.'
            ),
            t(
              'Add classes for each department, then add the sections under each class and name the class teacher.',
              'ಪ್ರತಿ ವಿಭಾಗಕ್ಕೆ ತರಗತಿಗಳನ್ನು ಸೇರಿಸಿ, ನಂತರ ಪ್ರತಿ ತರಗತಿಯ ಅಡಿಯಲ್ಲಿ ವಿಭಾಗಗಳನ್ನು ಸೇರಿಸಿ ಮತ್ತು ವರ್ಗ ಶಿಕ್ಷಕರನ್ನು ನೇಮಿಸಿ.'
            ),
            t(
              'Add subjects, then create a course for each subject in each section.',
              'ವಿಷಯಗಳನ್ನು ಸೇರಿಸಿ, ನಂತರ ಪ್ರತಿ ವಿಭಾಗದ ಪ್ರತಿ ವಿಷಯಕ್ಕೂ ಒಂದು ಕೋರ್ಸ್ ಸೃಷ್ಟಿಸಿ.'
            ),
            t('Build the timetable last, once courses and teachers exist.', 'ಕೋರ್ಸ್ ಮತ್ತು ಶಿಕ್ಷಕರು ಸಿದ್ಧವಾದ ನಂತರ ಕೊನೆಗೆ ವೇಳಾಪಟ್ಟಿ ರಚಿಸಿ.'),
          ],
        },
        {
          title: t('Assigning courses to teachers', 'ಶಿಕ್ಷಕರಿಗೆ ಕೋರ್ಸ್ ನಿಯೋಜನೆ'),
          figure: 'form',
          caption: t('Course assignment', 'ಕೋರ್ಸ್ ನಿಯೋಜನೆ'),
          steps: [
            t('Open Faculty → Course Assignment and click Add.', 'ಸಿಬ್ಬಂದಿ → ಕೋರ್ಸ್ ನಿಯೋಜನೆ ತೆರೆದು ಸೇರಿಸಿ ಕ್ಲಿಕ್ ಮಾಡಿ.'),
            t('Choose the course and the teacher who will take it.', 'ಕೋರ್ಸ್ ಮತ್ತು ಅದನ್ನು ಬೋಧಿಸುವ ಶಿಕ್ಷಕರನ್ನು ಆಯ್ಕೆ ಮಾಡಿ.'),
            t(
              'Save. From that moment the teacher can mark attendance and enter marks for exactly those students, and no others.',
              'ಉಳಿಸಿ. ಆ ಕ್ಷಣದಿಂದ ಆ ಶಿಕ್ಷಕರು ಆ ವಿದ್ಯಾರ್ಥಿಗಳಿಗೆ ಮಾತ್ರ ಹಾಜರಾತಿ ಮತ್ತು ಅಂಕ ನಮೂದಿಸಬಹುದು, ಬೇರೆಯವರಿಗಲ್ಲ.'
            ),
            t(
              'A class teacher named on a section additionally sees every subject and record of that section.',
              'ಒಂದು ವಿಭಾಗದ ವರ್ಗ ಶಿಕ್ಷಕರಾಗಿ ನೇಮಕವಾದವರು ಆ ವಿಭಾಗದ ಎಲ್ಲಾ ವಿಷಯ ಮತ್ತು ದಾಖಲೆಗಳನ್ನೂ ನೋಡಬಹುದು.'
            ),
          ],
          notes: [
            {
              tone: 'rule',
              title: t('Assignment is what grants access', 'ನಿಯೋಜನೆಯೇ ಪ್ರವೇಶವನ್ನು ನೀಡುತ್ತದೆ'),
              body: t(
                'A teacher can never open a class they are not assigned to. If a teacher reports that a class is missing, check this page first.',
                'ನಿಯೋಜಿಸದ ತರಗತಿಯನ್ನು ಶಿಕ್ಷಕರು ಎಂದಿಗೂ ತೆರೆಯಲಾಗದು. ತರಗತಿ ಕಾಣಿಸುತ್ತಿಲ್ಲ ಎಂದು ಶಿಕ್ಷಕರು ತಿಳಿಸಿದರೆ, ಮೊದಲು ಈ ಪುಟವನ್ನು ಪರಿಶೀಲಿಸಿ.'
              ),
            },
          ],
        },
      ],
    },
    {
      id: 'exams',
      icon: 'clipboard-check',
      title: t('Examinations and results', 'ಪರೀಕ್ಷೆ ಮತ್ತು ಫಲಿತಾಂಶ'),
      summary: t(
        'Creating an examination, approving the marks teachers submit, and publishing results.',
        'ಪರೀಕ್ಷೆ ಸೃಷ್ಟಿಸುವುದು, ಶಿಕ್ಷಕರು ಸಲ್ಲಿಸಿದ ಅಂಕಗಳನ್ನು ಅನುಮೋದಿಸುವುದು ಮತ್ತು ಫಲಿತಾಂಶ ಪ್ರಕಟಿಸುವುದು.'
      ),
      topics: [
        {
          title: t('Approving submitted marks', 'ಸಲ್ಲಿಸಿದ ಅಂಕಗಳ ಅನುಮೋದನೆ'),
          figure: 'marks',
          caption: t('Marks approval', 'ಅಂಕ ಅನುಮೋದನೆ'),
          steps: [
            t('Open Examination → Marks Approval and choose the examination.', 'ಪರೀಕ್ಷೆ → ಅಂಕ ಅನುಮೋದನೆ ತೆರೆದು ಪರೀಕ್ಷೆಯನ್ನು ಆಯ್ಕೆ ಮಾಡಿ.'),
            t(
              'Each class and section shows its state: pending, draft, submitted, approved or rejected.',
              'ಪ್ರತಿ ತರಗತಿ ಮತ್ತು ವಿಭಾಗವು ತನ್ನ ಸ್ಥಿತಿಯನ್ನು ತೋರಿಸುತ್ತದೆ: ಬಾಕಿ, ಕರಡು, ಸಲ್ಲಿಸಲಾಗಿದೆ, ಅನುಮೋದಿತ ಅಥವಾ ತಿರಸ್ಕೃತ.'
            ),
            t(
              'Open a submitted sheet and check the marks against the answer scripts.',
              'ಸಲ್ಲಿಸಿದ ಹಾಳೆಯನ್ನು ತೆರೆದು ಉತ್ತರ ಪತ್ರಿಕೆಗಳೊಂದಿಗೆ ಅಂಕಗಳನ್ನು ಪರಿಶೀಲಿಸಿ.'
            ),
            t(
              'Approve, or reject with a reason so the teacher can correct and submit again.',
              'ಅನುಮೋದಿಸಿ, ಅಥವಾ ಕಾರಣ ನೀಡಿ ತಿರಸ್ಕರಿಸಿ, ಇದರಿಂದ ಶಿಕ್ಷಕರು ಸರಿಪಡಿಸಿ ಮತ್ತೆ ಸಲ್ಲಿಸಬಹುದು.'
            ),
          ],
          notes: [
            {
              tone: 'info',
              title: t('Results become visible only after approval', 'ಅನುಮೋದನೆಯ ನಂತರವೇ ಫಲಿತಾಂಶ ಕಾಣಿಸುತ್ತದೆ'),
              body: t(
                'Students and parents see a result only once the marks are approved and the result is published.',
                'ಅಂಕಗಳು ಅನುಮೋದನೆಗೊಂಡು ಫಲಿತಾಂಶ ಪ್ರಕಟವಾದ ನಂತರವೇ ವಿದ್ಯಾರ್ಥಿಗಳು ಮತ್ತು ಪೋಷಕರು ಅದನ್ನು ನೋಡುತ್ತಾರೆ.'
              ),
            },
          ],
        },
      ],
    },
    {
      id: 'password-resets',
      icon: 'key',
      title: t('Password resets', 'ಪಾಸ್‌ವರ್ಡ್ ಮರುಹೊಂದಿಕೆ'),
      summary: t(
        'Working through the requests raised by people who cannot sign in.',
        'ಲಾಗಿನ್ ಆಗಲಾಗದವರು ಸಲ್ಲಿಸಿದ ಅರ್ಜಿಗಳನ್ನು ನಿರ್ವಹಿಸುವುದು.'
      ),
      topics: [
        {
          title: t('Issuing a temporary password', 'ತಾತ್ಕಾಲಿಕ ಪಾಸ್‌ವರ್ಡ್ ನೀಡುವುದು'),
          figure: 'list',
          caption: t('The password reset queue', 'ಪಾಸ್‌ವರ್ಡ್ ಮರುಹೊಂದಿಕೆ ಸರತಿ'),
          steps: [
            t(
              'Open Password Resets. Requests waiting to be dealt with are listed first.',
              'ಪಾಸ್‌ವರ್ಡ್ ಮರುಹೊಂದಿಕೆ ತೆರೆಯಿರಿ. ಬಾಕಿ ಇರುವ ಅರ್ಜಿಗಳು ಮೊದಲು ಕಾಣಿಸುತ್ತವೆ.'
            ),
            t(
              'Click Handle beside a request. Compare the telephone number given on the form with the number on the account, and satisfy yourself that you are speaking to the right person.',
              'ಅರ್ಜಿಯ ಪಕ್ಕದ ನಿರ್ವಹಿಸಿ ಕ್ಲಿಕ್ ಮಾಡಿ. ಅರ್ಜಿಯಲ್ಲಿ ನೀಡಿದ ದೂರವಾಣಿ ಸಂಖ್ಯೆಯನ್ನು ಖಾತೆಯಲ್ಲಿರುವ ಸಂಖ್ಯೆಯೊಂದಿಗೆ ಹೋಲಿಸಿ, ಸರಿಯಾದ ವ್ಯಕ್ತಿಯೊಂದಿಗೆ ಮಾತನಾಡುತ್ತಿದ್ದೀರಿ ಎಂದು ಖಚಿತಪಡಿಸಿಕೊಳ್ಳಿ.'
            ),
            t(
              'Write a short note saying how you identified them, then click Issue temporary password. Read the password out or write it down — it is shown only once.',
              'ನೀವು ಅವರನ್ನು ಹೇಗೆ ಗುರುತಿಸಿದಿರಿ ಎಂಬ ಸಂಕ್ಷಿಪ್ತ ಟಿಪ್ಪಣಿ ಬರೆದು, ತಾತ್ಕಾಲಿಕ ಪಾಸ್‌ವರ್ಡ್ ನೀಡಿ ಕ್ಲಿಕ್ ಮಾಡಿ. ಪಾಸ್‌ವರ್ಡ್ ಅನ್ನು ಓದಿ ಹೇಳಿ ಅಥವಾ ಬರೆದಿಟ್ಟುಕೊಳ್ಳಿ — ಅದು ಒಮ್ಮೆ ಮಾತ್ರ ಕಾಣಿಸುತ್ತದೆ.'
            ),
            t(
              'If you cannot identify the person, or the request is a duplicate, use Dismiss request instead.',
              'ವ್ಯಕ್ತಿಯನ್ನು ಗುರುತಿಸಲಾಗದಿದ್ದರೆ ಅಥವಾ ಅರ್ಜಿ ಪುನರಾವರ್ತಿತವಾಗಿದ್ದರೆ, ಬದಲಾಗಿ ಅರ್ಜಿ ತಿರಸ್ಕರಿಸಿ ಬಳಸಿ.'
            ),
          ],
          notes: [
            {
              tone: 'rule',
              title: t('Identify before you reset', 'ಮರುಹೊಂದಿಸುವ ಮೊದಲು ಗುರುತಿಸಿ'),
              body: t(
                'Anyone holding the temporary password can sign in as that person. The reset is recorded in the audit log against your name, together with your note.',
                'ತಾತ್ಕಾಲಿಕ ಪಾಸ್‌ವರ್ಡ್ ಇರುವ ಯಾರಾದರೂ ಆ ವ್ಯಕ್ತಿಯಂತೆ ಲಾಗಿನ್ ಆಗಬಹುದು. ಈ ಮರುಹೊಂದಿಕೆಯನ್ನು ನಿಮ್ಮ ಟಿಪ್ಪಣಿಯ ಸಹಿತ ನಿಮ್ಮ ಹೆಸರಿನಲ್ಲಿ ಲೆಕ್ಕಪರಿಶೋಧನಾ ದಾಖಲೆಯಲ್ಲಿ ದಾಖಲಿಸಲಾಗುತ್ತದೆ.'
              ),
            },
            {
              tone: 'warn',
              title: t('Admin accounts', 'ಅಡ್ಮಿನ್ ಖಾತೆಗಳು'),
              body: t(
                'An Administrator may reset students, parents and teaching or financial staff. An Admin or Administrator account can only be reset by an Admin.',
                'ಆಡಳಿತಾಧಿಕಾರಿಯು ವಿದ್ಯಾರ್ಥಿ, ಪೋಷಕರು ಮತ್ತು ಬೋಧಕ ಹಾಗೂ ಹಣಕಾಸು ಸಿಬ್ಬಂದಿಯ ಪಾಸ್‌ವರ್ಡ್ ಮರುಹೊಂದಿಸಬಹುದು. ಅಡ್ಮಿನ್ ಅಥವಾ ಆಡಳಿತಾಧಿಕಾರಿ ಖಾತೆಯನ್ನು ಅಡ್ಮಿನ್ ಮಾತ್ರ ಮರುಹೊಂದಿಸಬಹುದು.'
              ),
            },
          ],
        },
      ],
    },
    {
      id: 'reports-admin',
      icon: 'bar-chart',
      title: t('Reports and exports', 'ವರದಿಗಳು ಮತ್ತು ರಫ್ತು'),
      summary: t('Producing the lists and returns the school needs.', 'ಶಾಲೆಗೆ ಬೇಕಾದ ಪಟ್ಟಿ ಮತ್ತು ವರದಿಗಳನ್ನು ತಯಾರಿಸುವುದು.'),
      topics: [
        {
          title: t('Running a report', 'ವರದಿ ತಯಾರಿಸುವುದು'),
          figure: 'reports',
          caption: t('The reports page', 'ವರದಿಗಳ ಪುಟ'),
          steps: [
            t('Open Reports and choose the report, the period and the class or department.', 'ವರದಿಗಳನ್ನು ತೆರೆದು ವರದಿ, ಅವಧಿ ಮತ್ತು ತರಗತಿ ಅಥವಾ ವಿಭಾಗವನ್ನು ಆಯ್ಕೆ ಮಾಡಿ.'),
            t('Click Export to download the result as an Excel or PDF file.', 'ಫಲಿತಾಂಶವನ್ನು ಎಕ್ಸೆಲ್ ಅಥವಾ ಪಿಡಿಎಫ್ ಆಗಿ ಡೌನ್‌ಲೋಡ್ ಮಾಡಲು ರಫ್ತು ಕ್ಲಿಕ್ ಮಾಡಿ.'),
            t('The charts summarise the same figures — hover over a bar to read its exact value.', 'ಚಾರ್ಟ್‌ಗಳು ಅದೇ ಅಂಕಿಅಂಶಗಳ ಸಾರಾಂಶ — ನಿಖರ ಮೌಲ್ಯ ನೋಡಲು ಪಟ್ಟಿಯ ಮೇಲೆ ಮೌಸ್ ಇರಿಸಿ.'),
            t('The table below shows the detail behind the charts, row by row.', 'ಕೆಳಗಿನ ಕೋಷ್ಟಕವು ಚಾರ್ಟ್‌ಗಳ ಹಿಂದಿನ ವಿವರವನ್ನು ಸಾಲುವಾರು ತೋರಿಸುತ್ತದೆ.'),
          ],
        },
      ],
    },
    stayingInTouch(),
    accountChapter,
  ],
};

/* ===================================================================== */
/*  FINANCIAL STAFF                                                      */
/* ===================================================================== */

const FINANCIAL_STAFF = {
  role: t('Financial Staff', 'ಹಣಕಾಸು ಸಿಬ್ಬಂದಿ'),
  subtitle: t('Fees, payments and accounts', 'ಶುಲ್ಕ, ಪಾವತಿ ಮತ್ತು ಲೆಕ್ಕಪತ್ರ'),
  intro: t(
    'You collect fees, issue receipts, follow up arrears and keep the school’s income and expense records. You can see the fee position of any student, but not their marks or attendance.',
    'ನೀವು ಶುಲ್ಕ ಸಂಗ್ರಹಿಸುತ್ತೀರಿ, ರಸೀದಿ ನೀಡುತ್ತೀರಿ, ಬಾಕಿಯನ್ನು ಅನುಸರಿಸುತ್ತೀರಿ ಮತ್ತು ಶಾಲೆಯ ಆದಾಯ-ವೆಚ್ಚದ ದಾಖಲೆಗಳನ್ನು ನಿರ್ವಹಿಸುತ್ತೀರಿ. ಯಾವುದೇ ವಿದ್ಯಾರ್ಥಿಯ ಶುಲ್ಕ ಸ್ಥಿತಿಯನ್ನು ನೋಡಬಹುದು, ಆದರೆ ಅವರ ಅಂಕ ಅಥವಾ ಹಾಜರಾತಿಯನ್ನಲ್ಲ.'
  ),
  chapters: [
    signingIn(t('Financial Staff', 'ಹಣಕಾಸು ಸಿಬ್ಬಂದಿ')),
    {
      id: 'collecting',
      icon: 'credit-card',
      title: t('Collecting a fee', 'ಶುಲ್ಕ ಸಂಗ್ರಹಣೆ'),
      summary: t(
        'The everyday task at the counter: find the student, take the payment and hand over the receipt.',
        'ಕೌಂಟರ್‌ನಲ್ಲಿನ ದೈನಂದಿನ ಕೆಲಸ: ವಿದ್ಯಾರ್ಥಿಯನ್ನು ಹುಡುಕಿ, ಪಾವತಿ ಸ್ವೀಕರಿಸಿ ಮತ್ತು ರಸೀದಿ ನೀಡಿ.'
      ),
      topics: [
        {
          title: t('Find the student and open their fee account', 'ವಿದ್ಯಾರ್ಥಿಯನ್ನು ಹುಡುಕಿ ಶುಲ್ಕ ಖಾತೆ ತೆರೆಯಿರಿ'),
          figure: 'fees',
          caption: t('The student’s fee account', 'ವಿದ್ಯಾರ್ಥಿಯ ಶುಲ್ಕ ಖಾತೆ'),
          steps: [
            t(
              'Open Fee Collection, search by name or admission number, and click the student. The full fee account fills the page.',
              'ಶುಲ್ಕ ಸಂಗ್ರಹಣೆ ತೆರೆದು, ಹೆಸರು ಅಥವಾ ಪ್ರವೇಶ ಸಂಖ್ಯೆಯಿಂದ ಹುಡುಕಿ ವಿದ್ಯಾರ್ಥಿಯನ್ನು ಕ್ಲಿಕ್ ಮಾಡಿ. ಪೂರ್ಣ ಶುಲ್ಕ ಖಾತೆ ಪುಟದಲ್ಲಿ ತೆರೆಯುತ್ತದೆ.'
            ),
            t(
              'The four tiles show total billed, paid to date, outstanding balance and the number of fee heads.',
              'ನಾಲ್ಕು ಚೌಕಗಳು ಒಟ್ಟು ವಿಧಿಸಿದ ಮೊತ್ತ, ಇಲ್ಲಿಯವರೆಗೆ ಪಾವತಿಸಿದ್ದು, ಬಾಕಿ ಮತ್ತು ಶುಲ್ಕ ಶೀರ್ಷಿಕೆಗಳ ಸಂಖ್ಯೆಯನ್ನು ತೋರಿಸುತ್ತವೆ.'
            ),
            t(
              'The fee heads table lists every head with its payable, paid and balance amounts. An overdue head is flagged in red.',
              'ಶುಲ್ಕ ಶೀರ್ಷಿಕೆಗಳ ಕೋಷ್ಟಕವು ಪ್ರತಿ ಶೀರ್ಷಿಕೆಯ ಪಾವತಿಸಬೇಕಾದ, ಪಾವತಿಸಿದ ಮತ್ತು ಬಾಕಿ ಮೊತ್ತವನ್ನು ತೋರಿಸುತ್ತದೆ. ಅವಧಿ ಮೀರಿದ ಶೀರ್ಷಿಕೆ ಕೆಂಪು ಬಣ್ಣದಲ್ಲಿ ಗುರುತಿಸಲಾಗುತ್ತದೆ.'
            ),
            t(
              'Click Collect on the head being paid, enter the amount and the mode of payment, and save.',
              'ಪಾವತಿಸುತ್ತಿರುವ ಶೀರ್ಷಿಕೆಯ ಮೇಲೆ ಸಂಗ್ರಹಿಸಿ ಕ್ಲಿಕ್ ಮಾಡಿ, ಮೊತ್ತ ಮತ್ತು ಪಾವತಿ ವಿಧಾನ ನಮೂದಿಸಿ ಉಳಿಸಿ.'
            ),
          ],
          notes: [
            {
              tone: 'tip',
              title: t('Part payments are allowed', 'ಭಾಗಶಃ ಪಾವತಿಗೆ ಅವಕಾಶವಿದೆ'),
              body: t(
                'Enter whatever the parent is paying today. The balance stays against the head and the status changes to PARTIAL.',
                'ಇಂದು ಪೋಷಕರು ಪಾವತಿಸುತ್ತಿರುವ ಮೊತ್ತವನ್ನು ನಮೂದಿಸಿ. ಉಳಿದ ಬಾಕಿ ಆ ಶೀರ್ಷಿಕೆಯಲ್ಲೇ ಉಳಿಯುತ್ತದೆ ಮತ್ತು ಸ್ಥಿತಿ ಭಾಗಶಃ ಎಂದು ಬದಲಾಗುತ್ತದೆ.'
              ),
            },
          ],
        },
        {
          title: t('Printing the receipt', 'ರಸೀದಿ ಮುದ್ರಣ'),
          figure: 'document',
          caption: t('The fee receipt', 'ಶುಲ್ಕ ರಸೀದಿ'),
          steps: [
            t(
              'After saving, the payment appears in Payment history at the bottom of the fee account. Click Print.',
              'ಉಳಿಸಿದ ನಂತರ, ಪಾವತಿಯು ಶುಲ್ಕ ಖಾತೆಯ ಕೆಳಗಿನ ಪಾವತಿ ಇತಿಹಾಸದಲ್ಲಿ ಕಾಣಿಸುತ್ತದೆ. ಮುದ್ರಿಸಿ ಕ್ಲಿಕ್ ಮಾಡಿ.'
            ),
            t(
              'The receipt carries the school masthead, the receipt number and the date.',
              'ರಸೀದಿಯಲ್ಲಿ ಶಾಲೆಯ ಶಿರೋನಾಮೆ, ರಸೀದಿ ಸಂಖ್ಯೆ ಮತ್ತು ದಿನಾಂಕ ಇರುತ್ತದೆ.'
            ),
            t(
              'The table shows what was paid against which head, with the amount in words below.',
              'ಯಾವ ಶೀರ್ಷಿಕೆಗೆ ಎಷ್ಟು ಪಾವತಿಸಲಾಗಿದೆ ಎಂಬುದನ್ನು ಕೋಷ್ಟಕ ತೋರಿಸುತ್ತದೆ, ಕೆಳಗೆ ಮೊತ್ತವನ್ನು ಅಕ್ಷರಗಳಲ್ಲಿ ನೀಡಲಾಗಿದೆ.'
            ),
            t(
              'Sign under Authorised Signatory and give the printed copy to the parent.',
              'ಅಧಿಕೃತ ಸಹಿ ಎಂಬಲ್ಲಿ ಸಹಿ ಮಾಡಿ ಮುದ್ರಿತ ಪ್ರತಿಯನ್ನು ಪೋಷಕರಿಗೆ ನೀಡಿ.'
            ),
          ],
        },
      ],
    },
    {
      id: 'arrears',
      icon: 'alert-circle',
      title: t('Arrears and fee structures', 'ಬಾಕಿ ಮತ್ತು ಶುಲ್ಕ ರಚನೆ'),
      summary: t(
        'Seeing who has not paid, and setting what each class is charged.',
        'ಯಾರು ಪಾವತಿಸಿಲ್ಲ ಎಂದು ನೋಡುವುದು ಮತ್ತು ಪ್ರತಿ ತರಗತಿಗೆ ಎಷ್ಟು ವಿಧಿಸಬೇಕೆಂದು ನಿಗದಿಪಡಿಸುವುದು.'
      ),
      topics: [
        {
          title: t('Following up pending fees', 'ಬಾಕಿ ಶುಲ್ಕದ ಅನುಸರಣೆ'),
          figure: 'list',
          caption: t('Pending fees', 'ಬಾಕಿ ಶುಲ್ಕ'),
          steps: [
            t('Open Pending Fees to list every student with an outstanding balance.', 'ಬಾಕಿ ಇರುವ ಎಲ್ಲಾ ವಿದ್ಯಾರ್ಥಿಗಳನ್ನು ನೋಡಲು ಬಾಕಿ ಶುಲ್ಕ ತೆರೆಯಿರಿ.'),
            t('Search for a particular student, or leave it blank to see everyone.', 'ನಿರ್ದಿಷ್ಟ ವಿದ್ಯಾರ್ಥಿಯನ್ನು ಹುಡುಕಿ, ಅಥವಾ ಎಲ್ಲರನ್ನೂ ನೋಡಲು ಖಾಲಿ ಬಿಡಿ.'),
            t('Filter by class or by department to work through one group at a time.', 'ಒಂದೊಂದು ಗುಂಪಿನಂತೆ ಕೆಲಸ ಮಾಡಲು ತರಗತಿ ಅಥವಾ ವಿಭಾಗದ ಪ್ರಕಾರ ಶೋಧಿಸಿ.'),
            t('Use Collect beside a row to go straight to that student’s fee account.', 'ಆ ವಿದ್ಯಾರ್ಥಿಯ ಶುಲ್ಕ ಖಾತೆಗೆ ನೇರವಾಗಿ ಹೋಗಲು ಸಾಲಿನ ಪಕ್ಕದ ಸಂಗ್ರಹಿಸಿ ಬಳಸಿ.'),
          ],
        },
        {
          title: t('Fee structures and heads', 'ಶುಲ್ಕ ರಚನೆ ಮತ್ತು ಶೀರ್ಷಿಕೆಗಳು'),
          figure: 'form',
          caption: t('Adding a fee head', 'ಶುಲ್ಕ ಶೀರ್ಷಿಕೆ ಸೇರಿಸುವುದು'),
          steps: [
            t('Open Fee Management to see the structures already defined.', 'ಈಗಾಗಲೇ ನಿಗದಿಪಡಿಸಿದ ರಚನೆಗಳನ್ನು ನೋಡಲು ಶುಲ್ಕ ನಿರ್ವಹಣೆ ತೆರೆಯಿರಿ.'),
            t('Click Add, choose the class and academic year, and name the head.', 'ಸೇರಿಸಿ ಕ್ಲಿಕ್ ಮಾಡಿ, ತರಗತಿ ಮತ್ತು ಶೈಕ್ಷಣಿಕ ವರ್ಷ ಆಯ್ಕೆ ಮಾಡಿ, ಶೀರ್ಷಿಕೆಗೆ ಹೆಸರಿಡಿ.'),
            t('Enter the amount and the due date, then save.', 'ಮೊತ್ತ ಮತ್ತು ಪಾವತಿ ದಿನಾಂಕ ನಮೂದಿಸಿ ಉಳಿಸಿ.'),
            t('The head is then billed to every student of that class automatically.', 'ನಂತರ ಆ ತರಗತಿಯ ಪ್ರತಿ ವಿದ್ಯಾರ್ಥಿಗೂ ಆ ಶೀರ್ಷಿಕೆ ತಾನಾಗಿಯೇ ವಿಧಿಸಲ್ಪಡುತ್ತದೆ.'),
          ],
          notes: [
            {
              tone: 'warn',
              title: t('Check before you change an amount', 'ಮೊತ್ತ ಬದಲಾಯಿಸುವ ಮೊದಲು ಪರಿಶೀಲಿಸಿ'),
              body: t(
                'Changing a structure affects every student billed under it. The old and new values are recorded in the audit log.',
                'ರಚನೆಯನ್ನು ಬದಲಾಯಿಸಿದರೆ ಅದರಡಿ ಶುಲ್ಕ ವಿಧಿಸಲಾದ ಪ್ರತಿ ವಿದ್ಯಾರ್ಥಿಯ ಮೇಲೂ ಪರಿಣಾಮ ಬೀರುತ್ತದೆ. ಹಳೆಯ ಮತ್ತು ಹೊಸ ಮೌಲ್ಯಗಳು ಲೆಕ್ಕಪರಿಶೋಧನಾ ದಾಖಲೆಯಲ್ಲಿ ದಾಖಲಾಗುತ್ತವೆ.'
              ),
            },
          ],
        },
      ],
    },
    {
      id: 'accounts',
      icon: 'calculator',
      title: t('Income, expenses and petty cash', 'ಆದಾಯ, ವೆಚ್ಚ ಮತ್ತು ಸಣ್ಣ ನಗದು'),
      summary: t(
        'Recording money that comes in and goes out apart from fees.',
        'ಶುಲ್ಕವನ್ನು ಹೊರತುಪಡಿಸಿ ಬರುವ ಮತ್ತು ಹೋಗುವ ಹಣವನ್ನು ದಾಖಲಿಸುವುದು.'
      ),
      topics: [
        {
          title: t('Recording an entry', 'ನಮೂದನ್ನು ದಾಖಲಿಸುವುದು'),
          figure: 'list',
          caption: t('The expenses register', 'ವೆಚ್ಚದ ದಾಖಲೆ'),
          steps: [
            t(
              'Open Income, Expenses or Petty Cash and click Add. Each keeps its own register.',
              'ಆದಾಯ, ವೆಚ್ಚ ಅಥವಾ ಸಣ್ಣ ನಗದು ತೆರೆದು ಸೇರಿಸಿ ಕ್ಲಿಕ್ ಮಾಡಿ. ಪ್ರತಿಯೊಂದೂ ತನ್ನದೇ ದಾಖಲೆ ಇಟ್ಟುಕೊಳ್ಳುತ್ತದೆ.'
            ),
            t('Enter the date, the head, the amount and a short description.', 'ದಿನಾಂಕ, ಶೀರ್ಷಿಕೆ, ಮೊತ್ತ ಮತ್ತು ಸಂಕ್ಷಿಪ್ತ ವಿವರಣೆ ನಮೂದಿಸಿ.'),
            t('Filter the register by month to reconcile against the cash book.', 'ನಗದು ಪುಸ್ತಕದೊಂದಿಗೆ ಹೊಂದಿಸಲು ದಾಖಲೆಯನ್ನು ತಿಂಗಳವಾರು ಶೋಧಿಸಿ.'),
            t('Financial Analysis charts the totals so you can see the month at a glance.', 'ಹಣಕಾಸು ವಿಶ್ಲೇಷಣೆ ಒಟ್ಟು ಮೊತ್ತಗಳನ್ನು ಚಾರ್ಟ್ ಮಾಡುತ್ತದೆ, ಇದರಿಂದ ತಿಂಗಳ ಚಿತ್ರಣ ಒಂದೇ ನೋಟದಲ್ಲಿ ಸಿಗುತ್ತದೆ.'),
          ],
        },
      ],
    },
    stayingInTouch(),
    accountChapter,
  ],
};

/* ===================================================================== */
/*  TEACHING STAFF                                                       */
/* ===================================================================== */

const TEACHING_STAFF = {
  role: t('Teaching Staff', 'ಬೋಧಕ ಸಿಬ್ಬಂದಿ'),
  subtitle: t('Courses, attendance, marks and mentoring', 'ಕೋರ್ಸ್, ಹಾಜರಾತಿ, ಅಂಕ ಮತ್ತು ಮಾರ್ಗದರ್ಶನ'),
  intro: t(
    'You work with the students assigned to you. If you teach a subject, you see that subject’s students. If you are the class teacher of a section, you see every subject and record of that section. If you are a mentor, you can also see your mentees’ records.',
    'ನಿಮಗೆ ನಿಯೋಜಿಸಲಾದ ವಿದ್ಯಾರ್ಥಿಗಳೊಂದಿಗೆ ನೀವು ಕೆಲಸ ಮಾಡುತ್ತೀರಿ. ನೀವು ಒಂದು ವಿಷಯ ಬೋಧಿಸಿದರೆ, ಆ ವಿಷಯದ ವಿದ್ಯಾರ್ಥಿಗಳನ್ನು ನೋಡುತ್ತೀರಿ. ನೀವು ಒಂದು ವಿಭಾಗದ ವರ್ಗ ಶಿಕ್ಷಕರಾಗಿದ್ದರೆ, ಆ ವಿಭಾಗದ ಎಲ್ಲಾ ವಿಷಯ ಮತ್ತು ದಾಖಲೆಗಳನ್ನು ನೋಡುತ್ತೀರಿ. ನೀವು ಮಾರ್ಗದರ್ಶಕರಾಗಿದ್ದರೆ, ನಿಮ್ಮ ಮಾರ್ಗದರ್ಶಿತ ವಿದ್ಯಾರ್ಥಿಗಳ ದಾಖಲೆಗಳನ್ನೂ ನೋಡಬಹುದು.'
  ),
  chapters: [
    signingIn(t('a teacher', 'ಶಿಕ್ಷಕರು')),
    {
      id: 'my-classes',
      icon: 'book-open',
      title: t('My courses and students', 'ನನ್ನ ಕೋರ್ಸ್ ಮತ್ತು ವಿದ್ಯಾರ್ಥಿಗಳು'),
      summary: t(
        'What you have been assigned, and which students each assignment gives you.',
        'ನಿಮಗೆ ನಿಯೋಜಿಸಿರುವುದೇನು ಮತ್ತು ಪ್ರತಿ ನಿಯೋಜನೆಯು ಯಾವ ವಿದ್ಯಾರ್ಥಿಗಳನ್ನು ನೀಡುತ್ತದೆ.'
      ),
      topics: [
        {
          title: t('Your assigned courses', 'ನಿಮಗೆ ನಿಯೋಜಿತ ಕೋರ್ಸ್‌ಗಳು'),
          figure: 'list',
          caption: t('My Courses', 'ನನ್ನ ಕೋರ್ಸ್‌ಗಳು'),
          steps: [
            t('Open My Courses. Each card is one subject in one section.', 'ನನ್ನ ಕೋರ್ಸ್‌ಗಳನ್ನು ತೆರೆಯಿರಿ. ಪ್ರತಿ ಕಾರ್ಡ್ ಒಂದು ವಿಭಾಗದ ಒಂದು ವಿಷಯವಾಗಿದೆ.'),
            t('The card shows the class, section, department and the number of students.', 'ಕಾರ್ಡ್ ತರಗತಿ, ವಿಭಾಗ, ಮಂಡಳಿ ಮತ್ತು ವಿದ್ಯಾರ್ಥಿಗಳ ಸಂಖ್ಯೆಯನ್ನು ತೋರಿಸುತ್ತದೆ.'),
            t('Use the buttons on the card to jump straight to attendance, marks or materials for that course.', 'ಆ ಕೋರ್ಸ್‌ನ ಹಾಜರಾತಿ, ಅಂಕ ಅಥವಾ ಸಾಮಗ್ರಿಗೆ ನೇರವಾಗಿ ಹೋಗಲು ಕಾರ್ಡ್‌ನ ಬಟನ್‌ಗಳನ್ನು ಬಳಸಿ.'),
            t('My Students lists every student you may work with, drawn from all your assignments together.', 'ನನ್ನ ವಿದ್ಯಾರ್ಥಿಗಳು ಪುಟವು ನಿಮ್ಮ ಎಲ್ಲಾ ನಿಯೋಜನೆಗಳಿಂದ ಒಟ್ಟುಗೂಡಿಸಿ ನೀವು ಕೆಲಸ ಮಾಡಬಹುದಾದ ಎಲ್ಲಾ ವಿದ್ಯಾರ್ಥಿಗಳನ್ನು ತೋರಿಸುತ್ತದೆ.'),
          ],
          notes: [
            {
              tone: 'rule',
              title: t('Class teacher versus subject teacher', 'ವರ್ಗ ಶಿಕ್ಷಕರು ಮತ್ತು ವಿಷಯ ಶಿಕ್ಷಕರು'),
              body: t(
                'As a subject teacher you see only your subject’s students. As the class teacher of a section, you see all subjects and all records of that section. You can never open another teacher’s course.',
                'ವಿಷಯ ಶಿಕ್ಷಕರಾಗಿ ನಿಮ್ಮ ವಿಷಯದ ವಿದ್ಯಾರ್ಥಿಗಳನ್ನು ಮಾತ್ರ ನೋಡುತ್ತೀರಿ. ಒಂದು ವಿಭಾಗದ ವರ್ಗ ಶಿಕ್ಷಕರಾಗಿ, ಆ ವಿಭಾಗದ ಎಲ್ಲಾ ವಿಷಯ ಮತ್ತು ದಾಖಲೆಗಳನ್ನು ನೋಡುತ್ತೀರಿ. ಬೇರೊಬ್ಬ ಶಿಕ್ಷಕರ ಕೋರ್ಸ್ ಅನ್ನು ನೀವು ಎಂದಿಗೂ ತೆರೆಯಲಾಗದು.'
              ),
            },
          ],
        },
      ],
    },
    {
      id: 'attendance',
      icon: 'calendar-check',
      title: t('Marking attendance', 'ಹಾಜರಾತಿ ದಾಖಲಿಸುವುದು'),
      summary: t(
        'Taking the register each period, and copying it from the previous hour when the class is the same.',
        'ಪ್ರತಿ ಅವಧಿಯಲ್ಲಿ ಹಾಜರಾತಿ ತೆಗೆದುಕೊಳ್ಳುವುದು ಮತ್ತು ತರಗತಿ ಒಂದೇ ಆಗಿದ್ದಾಗ ಹಿಂದಿನ ಅವಧಿಯಿಂದ ನಕಲಿಸುವುದು.'
      ),
      topics: [
        {
          title: t('Taking the register', 'ಹಾಜರಾತಿ ತೆಗೆದುಕೊಳ್ಳುವುದು'),
          figure: 'attendance',
          caption: t('Mark Attendance', 'ಹಾಜರಾತಿ ದಾಖಲಿಸಿ'),
          steps: [
            t('Open Mark Attendance and choose the course, the date and the period.', 'ಹಾಜರಾತಿ ದಾಖಲಿಸಿ ತೆರೆದು ಕೋರ್ಸ್, ದಿನಾಂಕ ಮತ್ತು ಅವಧಿ ಆಯ್ಕೆ ಮಾಡಿ.'),
            t(
              'Use Mark all present to start, then change only the students who are absent. Copy from previous hour brings forward the last register for the same section.',
              'ಆರಂಭಿಸಲು ಎಲ್ಲರನ್ನೂ ಹಾಜರು ಎಂದು ಗುರುತಿಸಿ ಬಳಸಿ, ನಂತರ ಗೈರುಹಾಜರಾದವರನ್ನು ಮಾತ್ರ ಬದಲಾಯಿಸಿ. ಹಿಂದಿನ ಅವಧಿಯಿಂದ ನಕಲಿಸಿ ಎಂಬುದು ಅದೇ ವಿಭಾಗದ ಕೊನೆಯ ಹಾಜರಾತಿಯನ್ನು ತರುತ್ತದೆ.'
            ),
            t(
              'For each student choose Present or Absent. There are only these two states.',
              'ಪ್ರತಿ ವಿದ್ಯಾರ್ಥಿಗೆ ಹಾಜರು ಅಥವಾ ಗೈರುಹಾಜರು ಆಯ್ಕೆ ಮಾಡಿ. ಈ ಎರಡು ಸ್ಥಿತಿಗಳು ಮಾತ್ರ ಇವೆ.'
            ),
            t('Click Save attendance. Parents of absent students are notified.', 'ಹಾಜರಾತಿ ಉಳಿಸಿ ಕ್ಲಿಕ್ ಮಾಡಿ. ಗೈರುಹಾಜರಾದ ವಿದ್ಯಾರ್ಥಿಗಳ ಪೋಷಕರಿಗೆ ಸೂಚನೆ ಹೋಗುತ್ತದೆ.'),
          ],
          notes: [
            {
              tone: 'tip',
              title: t('Correcting a mistake', 'ತಪ್ಪನ್ನು ಸರಿಪಡಿಸುವುದು'),
              body: t(
                'Open the same course, date and period again, change the entry and save. Attendance History shows what was recorded on any past day.',
                'ಅದೇ ಕೋರ್ಸ್, ದಿನಾಂಕ ಮತ್ತು ಅವಧಿಯನ್ನು ಮತ್ತೆ ತೆರೆದು, ನಮೂದನ್ನು ಬದಲಾಯಿಸಿ ಉಳಿಸಿ. ಹಾಜರಾತಿ ಇತಿಹಾಸವು ಹಿಂದಿನ ಯಾವುದೇ ದಿನದ ದಾಖಲೆಯನ್ನು ತೋರಿಸುತ್ತದೆ.'
              ),
            },
          ],
        },
      ],
    },
    {
      id: 'marks',
      icon: 'clipboard-check',
      title: t('Entering marks', 'ಅಂಕ ನಮೂದಿಸುವುದು'),
      summary: t(
        'Marks are organised class by class, then section by section, then student by student.',
        'ಅಂಕಗಳನ್ನು ತರಗತಿವಾರು, ನಂತರ ವಿಭಾಗವಾರು, ನಂತರ ವಿದ್ಯಾರ್ಥಿವಾರು ಜೋಡಿಸಲಾಗಿದೆ.'
      ),
      topics: [
        {
          title: t('From class to section to student', 'ತರಗತಿಯಿಂದ ವಿಭಾಗಕ್ಕೆ, ವಿಭಾಗದಿಂದ ವಿದ್ಯಾರ್ಥಿಗೆ'),
          figure: 'marks',
          caption: t('Enter Marks', 'ಅಂಕ ನಮೂದಿಸಿ'),
          steps: [
            t('Open Enter Marks and choose the examination at the top.', 'ಅಂಕ ನಮೂದಿಸಿ ತೆರೆದು ಮೇಲ್ಭಾಗದಲ್ಲಿ ಪರೀಕ್ಷೆಯನ್ನು ಆಯ್ಕೆ ಮಾಡಿ.'),
            t(
              'Your sheets are grouped by class, then by section. Each card shows the subject and its state — pending, draft, submitted, approved or rejected.',
              'ನಿಮ್ಮ ಹಾಳೆಗಳನ್ನು ತರಗತಿವಾರು, ನಂತರ ವಿಭಾಗವಾರು ಗುಂಪು ಮಾಡಲಾಗಿದೆ. ಪ್ರತಿ ಕಾರ್ಡ್ ವಿಷಯ ಮತ್ತು ಅದರ ಸ್ಥಿತಿಯನ್ನು ತೋರಿಸುತ್ತದೆ — ಬಾಕಿ, ಕರಡು, ಸಲ್ಲಿಸಲಾಗಿದೆ, ಅನುಮೋದಿತ ಅಥವಾ ತಿರಸ್ಕೃತ.'
            ),
            t(
              'Click Enter marks on a card. Every student of that section is listed with a box for the mark; the grade and pass or fail update as you type.',
              'ಕಾರ್ಡ್ ಮೇಲೆ ಅಂಕ ನಮೂದಿಸಿ ಕ್ಲಿಕ್ ಮಾಡಿ. ಆ ವಿಭಾಗದ ಪ್ರತಿ ವಿದ್ಯಾರ್ಥಿಯೂ ಅಂಕದ ಪೆಟ್ಟಿಗೆಯೊಂದಿಗೆ ಪಟ್ಟಿಯಾಗುತ್ತಾರೆ; ಟೈಪ್ ಮಾಡುತ್ತಿದ್ದಂತೆ ಶ್ರೇಣಿ ಮತ್ತು ಉತ್ತೀರ್ಣ/ಅನುತ್ತೀರ್ಣ ನವೀಕರಣಗೊಳ್ಳುತ್ತದೆ.'
            ),
            t(
              'Save draft while you are still working. Submit only when the sheet is complete — after that it goes to the Administrator for approval and you cannot edit it.',
              'ಕೆಲಸ ನಡೆಯುತ್ತಿರುವಾಗ ಕರಡು ಉಳಿಸಿ. ಹಾಳೆ ಪೂರ್ಣಗೊಂಡಾಗ ಮಾತ್ರ ಸಲ್ಲಿಸಿ — ನಂತರ ಅದು ಅನುಮೋದನೆಗೆ ಆಡಳಿತಾಧಿಕಾರಿಗೆ ಹೋಗುತ್ತದೆ ಮತ್ತು ನೀವು ತಿದ್ದಲಾಗದು.'
            ),
          ],
          notes: [
            {
              tone: 'info',
              title: t('35% is a pass', '35% ಎಂದರೆ ಉತ್ತೀರ್ಣ'),
              body: t(
                'A student with an aggregate of 35% or more is shown as PASS on the report card.',
                'ಒಟ್ಟಾರೆ 35% ಅಥವಾ ಹೆಚ್ಚು ಪಡೆದ ವಿದ್ಯಾರ್ಥಿಯನ್ನು ಅಂಕಪಟ್ಟಿಯಲ್ಲಿ ಉತ್ತೀರ್ಣ ಎಂದು ತೋರಿಸಲಾಗುತ್ತದೆ.'
              ),
            },
            {
              tone: 'warn',
              title: t('If a sheet is rejected', 'ಹಾಳೆ ತಿರಸ್ಕೃತವಾದರೆ'),
              body: t(
                'The card turns red and shows the reason. Open it, correct the marks and submit again.',
                'ಕಾರ್ಡ್ ಕೆಂಪಾಗಿ ಕಾರಣವನ್ನು ತೋರಿಸುತ್ತದೆ. ಅದನ್ನು ತೆರೆದು, ಅಂಕಗಳನ್ನು ಸರಿಪಡಿಸಿ ಮತ್ತೆ ಸಲ್ಲಿಸಿ.'
              ),
            },
          ],
        },
      ],
    },
    {
      id: 'materials',
      icon: 'files',
      title: t('Course materials', 'ಅಧ್ಯಯನ ಸಾಮಗ್ರಿ'),
      summary: t(
        'Uploading notes, question papers and assignments, and publishing them to your students.',
        'ಟಿಪ್ಪಣಿ, ಪ್ರಶ್ನೆಪತ್ರಿಕೆ ಮತ್ತು ಕಾರ್ಯಯೋಜನೆಗಳನ್ನು ಅಪ್‌ಲೋಡ್ ಮಾಡಿ ವಿದ್ಯಾರ್ಥಿಗಳಿಗೆ ಪ್ರಕಟಿಸುವುದು.'
      ),
      topics: [
        {
          title: t('Uploading and publishing', 'ಅಪ್‌ಲೋಡ್ ಮತ್ತು ಪ್ರಕಟಣೆ'),
          figure: 'materials',
          caption: t('Course Materials', 'ಅಧ್ಯಯನ ಸಾಮಗ್ರಿ'),
          steps: [
            t('Open Course Materials and choose the course you are uploading for.', 'ಅಧ್ಯಯನ ಸಾಮಗ್ರಿ ತೆರೆದು ನೀವು ಅಪ್‌ಲೋಡ್ ಮಾಡುತ್ತಿರುವ ಕೋರ್ಸ್ ಆಯ್ಕೆ ಮಾಡಿ.'),
            t(
              'Click Upload material, give it a title, choose the type — notes, assignment or question paper — and attach the file.',
              'ಸಾಮಗ್ರಿ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ ಕ್ಲಿಕ್ ಮಾಡಿ, ಶೀರ್ಷಿಕೆ ನೀಡಿ, ಪ್ರಕಾರ ಆಯ್ಕೆ ಮಾಡಿ — ಟಿಪ್ಪಣಿ, ಕಾರ್ಯಯೋಜನೆ ಅಥವಾ ಪ್ರಶ್ನೆಪತ್ರಿಕೆ — ಮತ್ತು ಫೈಲ್ ಲಗತ್ತಿಸಿ.'
            ),
            t(
              'The Publish tick is on by default, so the material reaches the class as soon as you save. Untick it to keep it as a draft that only you can see.',
              'ಪ್ರಕಟಿಸಿ ಎಂಬ ಗುರುತು ಪೂರ್ವನಿಯೋಜಿತವಾಗಿ ಆನ್ ಆಗಿರುತ್ತದೆ, ಆದ್ದರಿಂದ ಉಳಿಸಿದ ಕೂಡಲೇ ಸಾಮಗ್ರಿ ತರಗತಿಗೆ ತಲುಪುತ್ತದೆ. ನೀವು ಮಾತ್ರ ನೋಡಬಹುದಾದ ಕರಡಾಗಿ ಇಡಲು ಆ ಗುರುತನ್ನು ತೆಗೆಯಿರಿ.'
            ),
            t(
              'Click Publish when it is ready. It then appears for the students of that course, who can view or download it.',
              'ಸಿದ್ಧವಾದಾಗ ಪ್ರಕಟಿಸಿ ಕ್ಲಿಕ್ ಮಾಡಿ. ಆಗ ಅದು ಆ ಕೋರ್ಸ್‌ನ ವಿದ್ಯಾರ್ಥಿಗಳಿಗೆ ಕಾಣಿಸುತ್ತದೆ, ಅವರು ಅದನ್ನು ನೋಡಬಹುದು ಅಥವಾ ಡೌನ್‌ಲೋಡ್ ಮಾಡಬಹುದು.'
            ),
          ],
        },
      ],
    },
    {
      id: 'mentoring',
      icon: 'compass',
      title: t('Mentoring', 'ಮಾರ್ಗದರ್ಶನ'),
      summary: t(
        'Your mentees, their records, and the notes you keep on each meeting.',
        'ನಿಮ್ಮ ಮಾರ್ಗದರ್ಶಿತ ವಿದ್ಯಾರ್ಥಿಗಳು, ಅವರ ದಾಖಲೆಗಳು ಮತ್ತು ಪ್ರತಿ ಭೇಟಿಯ ಟಿಪ್ಪಣಿಗಳು.'
      ),
      topics: [
        {
          title: t('My mentees and their records', 'ನನ್ನ ಮಾರ್ಗದರ್ಶಿತ ವಿದ್ಯಾರ್ಥಿಗಳು ಮತ್ತು ಅವರ ದಾಖಲೆ'),
          figure: 'list',
          caption: t('My Mentees', 'ನನ್ನ ಮಾರ್ಗದರ್ಶಿತ ವಿದ್ಯಾರ್ಥಿಗಳು'),
          steps: [
            t('Open My Mentees to see the students assigned to you for guidance.', 'ಮಾರ್ಗದರ್ಶನಕ್ಕಾಗಿ ನಿಮಗೆ ನಿಯೋಜಿಸಿದ ವಿದ್ಯಾರ್ಥಿಗಳನ್ನು ನೋಡಲು ನನ್ನ ಮಾರ್ಗದರ್ಶಿತ ವಿದ್ಯಾರ್ಥಿಗಳು ತೆರೆಯಿರಿ.'),
            t(
              'Click View record to open a mentee’s profile — attendance, results and fee position together in one place.',
              'ಒಬ್ಬ ವಿದ್ಯಾರ್ಥಿಯ ಪ್ರೊಫೈಲ್ ತೆರೆಯಲು ದಾಖಲೆ ವೀಕ್ಷಿಸಿ ಕ್ಲಿಕ್ ಮಾಡಿ — ಹಾಜರಾತಿ, ಫಲಿತಾಂಶ ಮತ್ತು ಶುಲ್ಕ ಸ್ಥಿತಿ ಒಂದೇ ಕಡೆ.'
            ),
            t(
              'Open Mentoring Records and click Add to write up a meeting: the date, what was discussed and what was agreed.',
              'ಮಾರ್ಗದರ್ಶನ ದಾಖಲೆಗಳನ್ನು ತೆರೆದು ಸೇರಿಸಿ ಕ್ಲಿಕ್ ಮಾಡಿ ಭೇಟಿಯನ್ನು ದಾಖಲಿಸಿ: ದಿನಾಂಕ, ಚರ್ಚಿಸಿದ ವಿಷಯ ಮತ್ತು ತೀರ್ಮಾನ.'
            ),
            t(
              'The student and their parents can see the record in their own portals, so write it as you would a note home.',
              'ವಿದ್ಯಾರ್ಥಿ ಮತ್ತು ಪೋಷಕರು ತಮ್ಮ ಪೋರ್ಟಲ್‌ನಲ್ಲಿ ಈ ದಾಖಲೆಯನ್ನು ನೋಡಬಲ್ಲರು, ಆದ್ದರಿಂದ ಮನೆಗೆ ಬರೆಯುವ ಟಿಪ್ಪಣಿಯಂತೆ ಬರೆಯಿರಿ.'
            ),
          ],
        },
      ],
    },
    stayingInTouch(),
    accountChapter,
  ],
};

/* ===================================================================== */
/*  STUDENT                                                              */
/* ===================================================================== */

/* ===================================================================== */
/*  PARENT                                                               */
/* ===================================================================== */

const PARENT = {
  role: t('Parent', 'ಪೋಷಕರು'),
  subtitle: t('Your child’s whole record', 'ನಿಮ್ಮ ಮಗುವಿನ ಸಂಪೂರ್ಣ ದಾಖಲೆ'),
  intro: t(
    'Everything about your child is here: attendance, results, timetable, course materials, fees, mentoring and transport, as well as notices from the school. Pupils do not sign in separately — you hold the family’s account. If you have more than one child at the school, use the selector at the top of the screen to switch between them; you can see only your own children’s records.',
    'ನಿಮ್ಮ ಮಗುವಿನ ಬಗ್ಗೆ ಎಲ್ಲವೂ ಇಲ್ಲಿದೆ: ಹಾಜರಾತಿ, ಫಲಿತಾಂಶ, ವೇಳಾಪಟ್ಟಿ, ಅಧ್ಯಯನ ಸಾಮಗ್ರಿ, ಶುಲ್ಕ, ಮಾರ್ಗದರ್ಶನ ಮತ್ತು ಸಾರಿಗೆ, ಹಾಗೂ ಶಾಲೆಯ ಸೂಚನೆಗಳು. ವಿದ್ಯಾರ್ಥಿಗಳು ಪ್ರತ್ಯೇಕವಾಗಿ ಲಾಗಿನ್ ಆಗುವುದಿಲ್ಲ — ಕುಟುಂಬದ ಖಾತೆ ನಿಮ್ಮ ಬಳಿ ಇರುತ್ತದೆ. ಶಾಲೆಯಲ್ಲಿ ಒಂದಕ್ಕಿಂತ ಹೆಚ್ಚು ಮಕ್ಕಳಿದ್ದರೆ, ಪರದೆಯ ಮೇಲ್ಭಾಗದ ಆಯ್ಕೆಯಿಂದ ಅವರ ನಡುವೆ ಬದಲಾಯಿಸಿ; ನಿಮ್ಮ ಸ್ವಂತ ಮಕ್ಕಳ ದಾಖಲೆಗಳನ್ನು ಮಾತ್ರ ನೀವು ನೋಡಬಹುದು.'
  ),
  chapters: [
    signingIn(t('a parent', 'ಪೋಷಕರು')),
    {
      id: 'parent-home',
      icon: 'dashboard',
      title: t('Your dashboard and your child', 'ನಿಮ್ಮ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್ ಮತ್ತು ನಿಮ್ಮ ಮಗು'),
      summary: t(
        'Choosing which child you are looking at, and reading the summary.',
        'ಯಾವ ಮಗುವಿನ ವಿವರ ನೋಡುತ್ತಿದ್ದೀರಿ ಎಂದು ಆಯ್ಕೆ ಮಾಡುವುದು ಮತ್ತು ಸಾರಾಂಶ ಓದುವುದು.'
      ),
      topics: [
        {
          title: t('The dashboard', 'ಡ್ಯಾಶ್‌ಬೋರ್ಡ್'),
          figure: 'portal',
          caption: t('The parent dashboard', 'ಪೋಷಕರ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್'),
          steps: [
            t(
              'If you have more than one child in the school, use the selector at the top to choose which one you are looking at.',
              'ಶಾಲೆಯಲ್ಲಿ ಒಂದಕ್ಕಿಂತ ಹೆಚ್ಚು ಮಕ್ಕಳಿದ್ದರೆ, ಯಾರ ವಿವರ ನೋಡಬೇಕೆಂದು ಆಯ್ಕೆ ಮಾಡಲು ಮೇಲಿನ ಆಯ್ಕೆ ಪಟ್ಟಿ ಬಳಸಿ.'
            ),
            t(
              'The tiles show attendance, the latest result, the fee balance and any pending items.',
              'ಚೌಕಗಳು ಹಾಜರಾತಿ, ಇತ್ತೀಚಿನ ಫಲಿತಾಂಶ, ಶುಲ್ಕ ಬಾಕಿ ಮತ್ತು ಬಾಕಿ ಇರುವ ವಿಷಯಗಳನ್ನು ತೋರಿಸುತ್ತವೆ.'
            ),
            t('The left panel shows recent attendance, day by day.', 'ಎಡ ಫಲಕವು ಇತ್ತೀಚಿನ ಹಾಜರಾತಿಯನ್ನು ದಿನವಾರು ತೋರಿಸುತ್ತದೆ.'),
            t('The right panel shows notices, announcements and circulars from the school.', 'ಬಲ ಫಲಕವು ಶಾಲೆಯ ಸೂಚನೆ, ಪ್ರಕಟಣೆ ಮತ್ತು ಸುತ್ತೋಲೆಗಳನ್ನು ತೋರಿಸುತ್ತದೆ.'),
          ],
        },
      ],
    },
    {
      id: 'parent-progress',
      icon: 'trending-up',
      title: t('Attendance and academic performance', 'ಹಾಜರಾತಿ ಮತ್ತು ಶೈಕ್ಷಣಿಕ ಪ್ರಗತಿ'),
      summary: t(
        'Following how your child is doing through the year.',
        'ವರ್ಷದುದ್ದಕ್ಕೂ ನಿಮ್ಮ ಮಗುವಿನ ಪ್ರಗತಿಯನ್ನು ಗಮನಿಸುವುದು.'
      ),
      topics: [
        {
          title: t('Results and the report card', 'ಫಲಿತಾಂಶ ಮತ್ತು ಅಂಕಪಟ್ಟಿ'),
          figure: 'document',
          caption: t('The report card', 'ಅಂಕಪಟ್ಟಿ'),
          steps: [
            t('Open Results, choose the examination, and use Print to print or save a copy.', 'ಫಲಿತಾಂಶ ತೆರೆದು ಪರೀಕ್ಷೆ ಆಯ್ಕೆ ಮಾಡಿ, ಪ್ರತಿ ಮುದ್ರಿಸಲು ಅಥವಾ ಉಳಿಸಲು ಮುದ್ರಿಸಿ ಬಳಸಿ.'),
            t('The card shows the school, the examination and your child’s class and section.', 'ಪಟ್ಟಿಯಲ್ಲಿ ಶಾಲೆ, ಪರೀಕ್ಷೆ ಮತ್ತು ನಿಮ್ಮ ಮಗುವಿನ ತರಗತಿ ಹಾಗೂ ವಿಭಾಗ ಇರುತ್ತದೆ.'),
            t('Each subject is listed with the maximum mark, the mark obtained and the grade.', 'ಪ್ರತಿ ವಿಷಯವನ್ನು ಗರಿಷ್ಠ ಅಂಕ, ಪಡೆದ ಅಂಕ ಮತ್ತು ಶ್ರೇಣಿಯೊಂದಿಗೆ ಪಟ್ಟಿ ಮಾಡಲಾಗಿದೆ.'),
            t('The overall percentage and the result appear below; 35% or more is a pass.', 'ಒಟ್ಟಾರೆ ಶೇಕಡಾವಾರು ಮತ್ತು ಫಲಿತಾಂಶ ಕೆಳಗೆ ಕಾಣಿಸುತ್ತದೆ; 35% ಅಥವಾ ಹೆಚ್ಚು ಎಂದರೆ ಉತ್ತೀರ್ಣ.'),
          ],
          notes: [
            {
              tone: 'info',
              title: t('Academic Performance', 'ಶೈಕ್ಷಣಿಕ ಪ್ರಗತಿ'),
              body: t(
                'This page charts your child’s marks across all examinations of the year, so you can see the trend rather than one result alone.',
                'ಈ ಪುಟವು ವರ್ಷದ ಎಲ್ಲಾ ಪರೀಕ್ಷೆಗಳ ಅಂಕಗಳನ್ನು ಚಾರ್ಟ್ ಮಾಡುತ್ತದೆ, ಇದರಿಂದ ಒಂದೇ ಫಲಿತಾಂಶವಲ್ಲದೆ ಒಟ್ಟಾರೆ ಪ್ರವೃತ್ತಿ ಕಾಣುತ್ತದೆ.'
              ),
            },
          ],
        },
      ],
    },
    {
      id: 'parent-materials',
      icon: 'files',
      title: t('Course materials', 'ಅಧ್ಯಯನ ಸಾಮಗ್ರಿ'),
      summary: t(
        'Notes, assignments and question papers the teachers have published for your child.',
        'ನಿಮ್ಮ ಮಗುವಿಗಾಗಿ ಶಿಕ್ಷಕರು ಪ್ರಕಟಿಸಿದ ಟಿಪ್ಪಣಿ, ಕಾರ್ಯಯೋಜನೆ ಮತ್ತು ಪ್ರಶ್ನೆಪತ್ರಿಕೆಗಳು.'
      ),
      topics: [
        {
          title: t('Viewing and downloading', 'ನೋಡುವುದು ಮತ್ತು ಡೌನ್‌ಲೋಡ್ ಮಾಡುವುದು'),
          figure: 'materials',
          caption: t('Course Materials', 'ಅಧ್ಯಯನ ಸಾಮಗ್ರಿ'),
          steps: [
            t('Open Course Materials. Use the search box to find a material by title.', 'ಅಧ್ಯಯನ ಸಾಮಗ್ರಿ ತೆರೆಯಿರಿ. ಶೀರ್ಷಿಕೆಯಿಂದ ಹುಡುಕಲು ಹುಡುಕಾಟ ಪೆಟ್ಟಿಗೆ ಬಳಸಿ.'),
            t('Filter by subject to see only one course at a time.', 'ಒಂದೇ ಕೋರ್ಸ್ ನೋಡಲು ವಿಷಯದ ಪ್ರಕಾರ ಶೋಧಿಸಿ.'),
            t('The tag beside each item says whether it is notes, an assignment or a question paper.', 'ಪ್ರತಿ ಸಾಮಗ್ರಿಯ ಪಕ್ಕದ ಗುರುತು ಅದು ಟಿಪ್ಪಣಿಯೋ, ಕಾರ್ಯಯೋಜನೆಯೋ ಅಥವಾ ಪ್ರಶ್ನೆಪತ್ರಿಕೆಯೋ ಎಂದು ತಿಳಿಸುತ್ತದೆ.'),
            t('Use View to open it, or Download to save it for your child.', 'ತೆರೆಯಲು ವೀಕ್ಷಿಸಿ, ನಿಮ್ಮ ಮಗುವಿಗಾಗಿ ಉಳಿಸಲು ಡೌನ್‌ಲೋಡ್ ಬಳಸಿ.'),
          ],
          notes: [
            {
              tone: 'info',
              title: t('Courses and timetable', 'ಕೋರ್ಸ್ ಮತ್ತು ವೇಳಾಪಟ್ಟಿ'),
              body: t(
                'Courses lists every subject your child takes with its teacher, and Timetable shows the week period by period.',
                'ಕೋರ್ಸ್‌ಗಳು ಪುಟವು ನಿಮ್ಮ ಮಗು ಕಲಿಯುವ ಪ್ರತಿ ವಿಷಯವನ್ನು ಅದರ ಶಿಕ್ಷಕರ ಸಹಿತ ತೋರಿಸುತ್ತದೆ, ಮತ್ತು ವೇಳಾಪಟ್ಟಿ ವಾರವನ್ನು ಅವಧಿವಾರು ತೋರಿಸುತ್ತದೆ.'
              ),
            },
          ],
        },
      ],
    },
    {
      id: 'parent-fees',
      icon: 'wallet',
      title: t('Fees', 'ಶುಲ್ಕ'),
      summary: t('What has been billed, what has been paid and what is due.', 'ವಿಧಿಸಿದ್ದೇನು, ಪಾವತಿಸಿದ್ದೇನು ಮತ್ತು ಬಾಕಿ ಏನು.'),
      topics: [
        {
          title: t('Checking the fee position', 'ಶುಲ್ಕ ಸ್ಥಿತಿ ಪರಿಶೀಲನೆ'),
          figure: 'fees',
          caption: t('The fee page', 'ಶುಲ್ಕ ಪುಟ'),
          steps: [
            t('Open Fees to see your child’s fee account.', 'ನಿಮ್ಮ ಮಗುವಿನ ಶುಲ್ಕ ಖಾತೆ ನೋಡಲು ಶುಲ್ಕ ತೆರೆಯಿರಿ.'),
            t('The tiles show total billed, paid to date and the balance outstanding.', 'ಚೌಕಗಳು ಒಟ್ಟು ವಿಧಿಸಿದ ಮೊತ್ತ, ಇಲ್ಲಿಯವರೆಗೆ ಪಾವತಿಸಿದ್ದು ಮತ್ತು ಬಾಕಿಯನ್ನು ತೋರಿಸುತ್ತವೆ.'),
            t('Each fee head shows its due date; an overdue head is marked in red.', 'ಪ್ರತಿ ಶುಲ್ಕ ಶೀರ್ಷಿಕೆಯು ಪಾವತಿ ದಿನಾಂಕವನ್ನು ತೋರಿಸುತ್ತದೆ; ಅವಧಿ ಮೀರಿದ್ದನ್ನು ಕೆಂಪಿನಲ್ಲಿ ಗುರುತಿಸಲಾಗುತ್ತದೆ.'),
            t('Use Print beside a payment to open the receipt for your records.', 'ನಿಮ್ಮ ದಾಖಲೆಗಾಗಿ ರಸೀದಿ ತೆರೆಯಲು ಪಾವತಿಯ ಪಕ್ಕದ ಮುದ್ರಿಸಿ ಬಳಸಿ.'),
          ],
          notes: [
            {
              tone: 'info',
              title: t('Paying the fee', 'ಶುಲ್ಕ ಪಾವತಿ'),
              body: t(
                'Fees are collected at the school office. The portal shows the position and the receipts; it does not take payment online.',
                'ಶುಲ್ಕವನ್ನು ಶಾಲಾ ಕಚೇರಿಯಲ್ಲಿ ಸಂಗ್ರಹಿಸಲಾಗುತ್ತದೆ. ಪೋರ್ಟಲ್ ಸ್ಥಿತಿ ಮತ್ತು ರಸೀದಿಗಳನ್ನು ತೋರಿಸುತ್ತದೆ; ಆನ್‌ಲೈನ್ ಪಾವತಿ ಸ್ವೀಕರಿಸುವುದಿಲ್ಲ.'
              ),
            },
          ],
        },
      ],
    },
    stayingInTouch({
      leaveTitle: t('Applying for your child’s leave', 'ನಿಮ್ಮ ಮಗುವಿನ ರಜೆಗೆ ಅರ್ಜಿ'),
    }),
    accountChapter,
  ],
};

/* ===================================================================== */
/*  ADMIN                                                                */
/* ===================================================================== */

const ADMIN = {
  role: t('Admin', 'ಅಡ್ಮಿನ್'),
  subtitle: t('Complete software control', 'ಸಂಪೂರ್ಣ ವ್ಯವಸ್ಥೆಯ ನಿಯಂತ್ರಣ'),
  intro: t(
    'You control the whole system: users, roles and permissions, both departments, system settings and the audit log. Everything the other roles can do, you can do as well.',
    'ಇಡೀ ವ್ಯವಸ್ಥೆಯ ಮೇಲೆ ನಿಮಗೆ ನಿಯಂತ್ರಣವಿದೆ: ಬಳಕೆದಾರರು, ಪಾತ್ರಗಳು ಮತ್ತು ಅನುಮತಿಗಳು, ಎರಡೂ ವಿಭಾಗಗಳು, ವ್ಯವಸ್ಥೆಯ ಸೆಟ್ಟಿಂಗ್‌ಗಳು ಮತ್ತು ಲೆಕ್ಕಪರಿಶೋಧನಾ ದಾಖಲೆ. ಇತರ ಪಾತ್ರಗಳು ಮಾಡಬಹುದಾದ ಎಲ್ಲವನ್ನೂ ನೀವೂ ಮಾಡಬಹುದು.'
  ),
  chapters: [
    signingIn(t('the Admin', 'ಅಡ್ಮಿನ್')),
    {
      id: 'roles',
      icon: 'shield-check',
      title: t('Users, roles and permissions', 'ಬಳಕೆದಾರರು, ಪಾತ್ರಗಳು ಮತ್ತು ಅನುಮತಿಗಳು'),
      summary: t(
        'Who can sign in, and exactly what each of them may do.',
        'ಯಾರು ಲಾಗಿನ್ ಆಗಬಹುದು ಮತ್ತು ಪ್ರತಿಯೊಬ್ಬರೂ ನಿಖರವಾಗಿ ಏನು ಮಾಡಬಹುದು.'
      ),
      topics: [
        {
          title: t('Granting and withdrawing permissions', 'ಅನುಮತಿ ನೀಡುವುದು ಮತ್ತು ಹಿಂಪಡೆಯುವುದು'),
          figure: 'permissions',
          caption: t('Roles & Permissions', 'ಪಾತ್ರಗಳು ಮತ್ತು ಅನುಮತಿಗಳು'),
          steps: [
            t('Open Roles & Permissions and choose a role from the list on the left.', 'ಪಾತ್ರಗಳು ಮತ್ತು ಅನುಮತಿಗಳನ್ನು ತೆರೆದು ಎಡಭಾಗದ ಪಟ್ಟಿಯಿಂದ ಒಂದು ಪಾತ್ರವನ್ನು ಆಯ್ಕೆ ಮಾಡಿ.'),
            t('Use the search box to find a permission by module or action.', 'ಮಾಡ್ಯೂಲ್ ಅಥವಾ ಕ್ರಿಯೆಯ ಪ್ರಕಾರ ಅನುಮತಿಯನ್ನು ಹುಡುಕಲು ಹುಡುಕಾಟ ಪೆಟ್ಟಿಗೆ ಬಳಸಿ.'),
            t('Tick or untick the boxes to grant or withdraw view, create, edit and delete for that module.', 'ಆ ಮಾಡ್ಯೂಲ್‌ಗೆ ವೀಕ್ಷಣೆ, ಸೃಷ್ಟಿ, ತಿದ್ದುಪಡಿ ಮತ್ತು ಅಳಿಸುವಿಕೆ ಅನುಮತಿ ನೀಡಲು ಅಥವಾ ಹಿಂಪಡೆಯಲು ಪೆಟ್ಟಿಗೆಗಳನ್ನು ಗುರುತಿಸಿ ಅಥವಾ ತೆಗೆಯಿರಿ.'),
            t('Save. The change applies to everyone holding that role the next time they sign in.', 'ಉಳಿಸಿ. ಆ ಪಾತ್ರ ಹೊಂದಿರುವ ಎಲ್ಲರಿಗೂ ಮುಂದಿನ ಬಾರಿ ಲಾಗಿನ್ ಆದಾಗ ಬದಲಾವಣೆ ಅನ್ವಯವಾಗುತ್ತದೆ.'),
          ],
          notes: [
            {
              tone: 'rule',
              title: t('The server always checks', 'ಸರ್ವರ್ ಯಾವಾಗಲೂ ಪರಿಶೀಲಿಸುತ್ತದೆ'),
              body: t(
                'Hiding a menu item is only presentation. The server independently verifies the role, the permission and whether the record belongs to the user, on every request.',
                'ಮೆನು ಐಟಂ ಮರೆಮಾಡುವುದು ಕೇವಲ ಪ್ರದರ್ಶನ. ಪ್ರತಿ ಮನವಿಯಲ್ಲೂ ಸರ್ವರ್ ಸ್ವತಂತ್ರವಾಗಿ ಪಾತ್ರ, ಅನುಮತಿ ಮತ್ತು ದಾಖಲೆ ಆ ಬಳಕೆದಾರರಿಗೆ ಸೇರಿದೆಯೇ ಎಂಬುದನ್ನು ಪರಿಶೀಲಿಸುತ್ತದೆ.'
              ),
            },
          ],
        },
      ],
    },
    {
      id: 'password-resets',
      icon: 'key',
      title: t('Password resets', 'ಪಾಸ್‌ವರ್ಡ್ ಮರುಹೊಂದಿಕೆ'),
      summary: t(
        'Working through the requests raised by people who cannot sign in.',
        'ಲಾಗಿನ್ ಆಗಲಾಗದವರು ಸಲ್ಲಿಸಿದ ಅರ್ಜಿಗಳನ್ನು ನಿರ್ವಹಿಸುವುದು.'
      ),
      topics: [
        {
          title: t('Issuing a temporary password', 'ತಾತ್ಕಾಲಿಕ ಪಾಸ್‌ವರ್ಡ್ ನೀಡುವುದು'),
          figure: 'list',
          caption: t('The password reset queue', 'ಪಾಸ್‌ವರ್ಡ್ ಮರುಹೊಂದಿಕೆ ಸರತಿ'),
          steps: [
            t(
              'Open Password Resets. Requests waiting to be dealt with are listed first.',
              'ಪಾಸ್‌ವರ್ಡ್ ಮರುಹೊಂದಿಕೆ ತೆರೆಯಿರಿ. ಬಾಕಿ ಇರುವ ಅರ್ಜಿಗಳು ಮೊದಲು ಕಾಣಿಸುತ್ತವೆ.'
            ),
            t(
              'Click Handle beside a request. Compare the telephone number given on the form with the number on the account, and satisfy yourself that you are speaking to the right person.',
              'ಅರ್ಜಿಯ ಪಕ್ಕದ ನಿರ್ವಹಿಸಿ ಕ್ಲಿಕ್ ಮಾಡಿ. ಅರ್ಜಿಯಲ್ಲಿ ನೀಡಿದ ದೂರವಾಣಿ ಸಂಖ್ಯೆಯನ್ನು ಖಾತೆಯಲ್ಲಿರುವ ಸಂಖ್ಯೆಯೊಂದಿಗೆ ಹೋಲಿಸಿ, ಸರಿಯಾದ ವ್ಯಕ್ತಿಯೊಂದಿಗೆ ಮಾತನಾಡುತ್ತಿದ್ದೀರಿ ಎಂದು ಖಚಿತಪಡಿಸಿಕೊಳ್ಳಿ.'
            ),
            t(
              'Write a short note saying how you identified them, then click Issue temporary password. Read the password out or write it down — it is shown only once.',
              'ನೀವು ಅವರನ್ನು ಹೇಗೆ ಗುರುತಿಸಿದಿರಿ ಎಂಬ ಸಂಕ್ಷಿಪ್ತ ಟಿಪ್ಪಣಿ ಬರೆದು, ತಾತ್ಕಾಲಿಕ ಪಾಸ್‌ವರ್ಡ್ ನೀಡಿ ಕ್ಲಿಕ್ ಮಾಡಿ. ಪಾಸ್‌ವರ್ಡ್ ಅನ್ನು ಓದಿ ಹೇಳಿ ಅಥವಾ ಬರೆದಿಟ್ಟುಕೊಳ್ಳಿ — ಅದು ಒಮ್ಮೆ ಮಾತ್ರ ಕಾಣಿಸುತ್ತದೆ.'
            ),
            t(
              'If you cannot identify the person, or the request is a duplicate, use Dismiss request instead.',
              'ವ್ಯಕ್ತಿಯನ್ನು ಗುರುತಿಸಲಾಗದಿದ್ದರೆ ಅಥವಾ ಅರ್ಜಿ ಪುನರಾವರ್ತಿತವಾಗಿದ್ದರೆ, ಬದಲಾಗಿ ಅರ್ಜಿ ತಿರಸ್ಕರಿಸಿ ಬಳಸಿ.'
            ),
          ],
          notes: [
            {
              tone: 'rule',
              title: t('Identify before you reset', 'ಮರುಹೊಂದಿಸುವ ಮೊದಲು ಗುರುತಿಸಿ'),
              body: t(
                'Anyone holding the temporary password can sign in as that person. The reset is recorded in the audit log against your name, together with your note.',
                'ತಾತ್ಕಾಲಿಕ ಪಾಸ್‌ವರ್ಡ್ ಇರುವ ಯಾರಾದರೂ ಆ ವ್ಯಕ್ತಿಯಂತೆ ಲಾಗಿನ್ ಆಗಬಹುದು. ಈ ಮರುಹೊಂದಿಕೆಯನ್ನು ನಿಮ್ಮ ಟಿಪ್ಪಣಿಯ ಸಹಿತ ನಿಮ್ಮ ಹೆಸರಿನಲ್ಲಿ ಲೆಕ್ಕಪರಿಶೋಧನಾ ದಾಖಲೆಯಲ್ಲಿ ದಾಖಲಿಸಲಾಗುತ್ತದೆ.'
              ),
            },
            {
              tone: 'warn',
              title: t('Admin accounts', 'ಅಡ್ಮಿನ್ ಖಾತೆಗಳು'),
              body: t(
                'An Administrator may reset students, parents and teaching or financial staff. An Admin or Administrator account can only be reset by an Admin.',
                'ಆಡಳಿತಾಧಿಕಾರಿಯು ವಿದ್ಯಾರ್ಥಿ, ಪೋಷಕರು ಮತ್ತು ಬೋಧಕ ಹಾಗೂ ಹಣಕಾಸು ಸಿಬ್ಬಂದಿಯ ಪಾಸ್‌ವರ್ಡ್ ಮರುಹೊಂದಿಸಬಹುದು. ಅಡ್ಮಿನ್ ಅಥವಾ ಆಡಳಿತಾಧಿಕಾರಿ ಖಾತೆಯನ್ನು ಅಡ್ಮಿನ್ ಮಾತ್ರ ಮರುಹೊಂದಿಸಬಹುದು.'
              ),
            },
          ],
        },
      ],
    },
    {
      id: 'audit',
      icon: 'history',
      title: t('Audit log and settings', 'ಲೆಕ್ಕಪರಿಶೋಧನಾ ದಾಖಲೆ ಮತ್ತು ಸೆಟ್ಟಿಂಗ್'),
      summary: t('Who changed what, and the settings that govern the school.', 'ಯಾರು ಏನನ್ನು ಬದಲಾಯಿಸಿದರು ಮತ್ತು ಶಾಲೆಯನ್ನು ನಿಯಂತ್ರಿಸುವ ಸೆಟ್ಟಿಂಗ್‌ಗಳು.'),
      topics: [
        {
          title: t('Reading the audit log', 'ಲೆಕ್ಕಪರಿಶೋಧನಾ ದಾಖಲೆ ಓದುವುದು'),
          figure: 'list',
          caption: t('Audit Logs', 'ಲೆಕ್ಕಪರಿಶೋಧನಾ ದಾಖಲೆಗಳು'),
          steps: [
            t('Open Audit Logs. Every important action is listed newest first.', 'ಲೆಕ್ಕಪರಿಶೋಧನಾ ದಾಖಲೆಗಳನ್ನು ತೆರೆಯಿರಿ. ಪ್ರತಿ ಮುಖ್ಯ ಕ್ರಿಯೆಯೂ ಹೊಸತು ಮೊದಲು ಎಂಬಂತೆ ಪಟ್ಟಿಯಾಗುತ್ತದೆ.'),
            t('Search or filter by user, module or date to find a particular change.', 'ನಿರ್ದಿಷ್ಟ ಬದಲಾವಣೆ ಹುಡುಕಲು ಬಳಕೆದಾರ, ಮಾಡ್ಯೂಲ್ ಅಥವಾ ದಿನಾಂಕದಿಂದ ಹುಡುಕಿ ಅಥವಾ ಶೋಧಿಸಿ.'),
            t('Open an entry to see the old value beside the new value.', 'ಹಳೆಯ ಮೌಲ್ಯವನ್ನು ಹೊಸ ಮೌಲ್ಯದ ಪಕ್ಕದಲ್ಲಿ ನೋಡಲು ನಮೂದನ್ನು ತೆರೆಯಿರಿ.'),
            t('System Settings holds the school details, the academic session and the pass mark used across the school.', 'ವ್ಯವಸ್ಥೆಯ ಸೆಟ್ಟಿಂಗ್‌ಗಳಲ್ಲಿ ಶಾಲೆಯ ವಿವರ, ಶೈಕ್ಷಣಿಕ ಅವಧಿ ಮತ್ತು ಶಾಲೆಯಾದ್ಯಂತ ಬಳಸುವ ಉತ್ತೀರ್ಣ ಅಂಕ ಇರುತ್ತದೆ.'),
          ],
        },
      ],
    },
    stayingInTouch(),
    accountChapter,
  ],
};

export const MANUALS = { ADMIN, ADMINISTRATOR, FINANCIAL_STAFF, TEACHING_STAFF, PARENT };

/** The three ways the manual can be read. */
export const LANGUAGES = [
  { id: 'both', label: 'English + ಕನ್ನಡ' },
  { id: 'en', label: 'English' },
  { id: 'kn', label: 'ಕನ್ನಡ' },
];

import { Template, waitForURL } from 'e2b';

export const BROWSER_TEMPLATE_NAME = 'superagent-browser';
export const CODE_TEMPLATE_NAME = 'superagent-code';

/** Python packages older than the 7-day release-age window used for npm. */
export const PY_PINS = {
  playwright: '1.63.0',
  numpy: '2.5.3',
  pandas: '3.0.6',
  matplotlib: '3.11.2',
};

/**
 * Enterprise policies for the sandboxed Google Chrome. They harden the profile (no sign-in, sync,
 * password manager, autofill or extensions) and block local/internal schemes and hosts as a second
 * layer behind the worker-side destination checks and E2B egress rules.
 */
export const CHROME_POLICIES = {
  BrowserSignin: 0,
  SyncDisabled: true,
  PasswordManagerEnabled: false,
  AutofillAddressEnabled: false,
  AutofillCreditCardEnabled: false,
  PaymentMethodQueryEnabled: false,
  ExtensionInstallBlocklist: ['*'],
  BackgroundModeEnabled: false,
  MetricsReportingEnabled: false,
  DefaultNotificationsSetting: 2,
  DefaultGeolocationSetting: 2,
  DefaultSensorsSetting: 2,
  DefaultSerialGuardSetting: 2,
  DefaultWebBluetoothGuardSetting: 2,
  DefaultWebUsbGuardSetting: 2,
  PromptForDownloadLocation: false,
  DownloadDirectory: '/tmp/superagent/downloads',
  URLBlocklist: [
    'file://*',
    'chrome://*',
    'chrome-extension://*',
    'chrome-untrusted://*',
    'devtools://*',
    'view-source:*',
    'javascript:*',
    'localhost',
    '127.0.0.1',
    '[::1]',
    '0.0.0.0',
    '169.254.169.254',
    'metadata.google.internal',
  ],
};

export const CDP_PORT = 9222;

/** Chrome listens for DevTools on sandbox loopback only; nothing is exposed through the E2B proxy. */
export const CHROME_START = [
  'google-chrome',
  '--headless=new',
  `--remote-debugging-address=127.0.0.1`,
  `--remote-debugging-port=${CDP_PORT}`,
  '--user-data-dir=/home/user/.superagent-chrome',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-dev-shm-usage',
  '--disable-sync',
  '--window-size=1280,900',
  'about:blank',
].join(' ');

export function browserTemplate() {
  const policies = JSON.stringify(CHROME_POLICIES);
  return Template()
    .fromBaseImage()
    .aptInstall(['curl', 'gnupg', 'ca-certificates', 'fonts-liberation', 'fonts-noto-color-emoji'])
    .runCmd(
      [
        'install -d -m 0755 /usr/share/keyrings',
        'curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg',
        'echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list',
        'apt-get update',
        'DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends google-chrome-stable',
        'install -d -m 0755 /etc/opt/chrome/policies/managed',
        `printf '%s' '${policies}' > /etc/opt/chrome/policies/managed/superagent.json`,
        'google-chrome --version',
      ],
      { user: 'root' },
    )
    .pipInstall([`playwright==${PY_PINS.playwright}`])
    .setUser('user')
    .setStartCmd(CHROME_START, waitForURL(`http://127.0.0.1:${CDP_PORT}/json/version`));
}

export function codeTemplate() {
  return Template()
    .fromBaseImage()
    .pipInstall([`numpy==${PY_PINS.numpy}`, `pandas==${PY_PINS.pandas}`, `matplotlib==${PY_PINS.matplotlib}`])
    .setUser('user');
}

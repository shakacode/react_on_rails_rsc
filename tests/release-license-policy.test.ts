import * as fs from 'fs';
import * as path from 'path';

const { verifyReleaseLicense } = require('../scripts/license-header.cjs');
const licenseText = fs.readFileSync(path.join(__dirname, '../LICENSE.md'), 'utf8');

describe('ShakaStack release license policy', () => {
  it('accepts the approved canonical text on the next React runtime line', () => {
    expect(verifyReleaseLicense('19.4.0', licenseText)).toBe(
      '811b0238d9eb4942a354c4d8d0c534341eaee5ea43b08ce48003cd7a41a1c071'
    );
  });

  it.each(['19.3.2', '19.4.0-rc.1'])('rejects package version %s', (version) => {
    expect(() => verifyReleaseLicense(version, licenseText)).toThrow(
      'The ShakaStack License requires package version 19.4.0 or later'
    );
  });

  it.each(['[COUNSEL-1]', '**Status: pending counsel review**'])('rejects %s', (notice) => {
    expect(() => verifyReleaseLicense('19.4.0', `${notice}\n${licenseText}`)).toThrow(
      'LICENSE.md contains a counsel marker or status notice'
    );
  });

  it('rejects changed canonical terms', () => {
    const changed = licenseText.replace(
      'The ShakaStack License, version 1.0',
      'The ShakaStack License, version 1.1'
    );
    expect(() => verifyReleaseLicense('19.4.0', changed)).toThrow();
  });
});

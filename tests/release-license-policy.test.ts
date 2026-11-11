import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

const { verifyReleaseLicense } = require('../scripts/license-header.cjs');
const licenseText = fs.readFileSync(path.join(__dirname, '../LICENSE.md'), 'utf8');
const previousLicenseText = zlib
  .gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures/license-3.0.md.gz')))
  .toString('utf8');

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

  it('accepts unchanged License 3.0 text on the React 19.3 maintenance line', () => {
    expect(verifyReleaseLicense('19.3.2', previousLicenseText)).toBe(
      '8b1ae877b9d415e677f520ca9791a6eeb70ef4fec3314a2dd318849398371a70'
    );
  });

  it.each(['[COUNSEL-1]', '**Status: pending counsel review**'])('rejects %s', (notice) => {
    expect(() => verifyReleaseLicense('19.4.0', `${notice}\n${licenseText}`)).toThrow(
      'LICENSE.md contains a counsel marker or status notice'
    );
  });

  it('rejects changed canonical terms', () => {
    const changed = licenseText.replace(
      'Part A holds the common terms',
      'Part A hides the common terms'
    );
    expect(() => verifyReleaseLicense('19.4.0', changed)).toThrow(
      'Canonical license SHA256 expected'
    );
  });

  it('rejects changed License 3.0 terms', () => {
    const changed = previousLicenseText.replace(
      'React on Rails Pro is trust-based',
      'React on Rails Pro is key-based'
    );
    expect(() => verifyReleaseLicense('19.3.2', changed)).toThrow(
      'Canonical license SHA256 expected'
    );
  });
});

// The entry imports Button DIRECTLY. Webpack then considers Button
// "available in the parent chunk" and leaves the async chunk group the
// plugin created for Button empty — the manifest must still contain an
// entry for Button (with no extra chunks to load) or Flight fails to
// resolve the reference at runtime.
import Button from './Button';

export const app = [Button];

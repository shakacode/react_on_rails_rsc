// The entry imports Button DIRECTLY, so webpack leaves Button's injected
// async chunk group empty (Button is already available in the parent entry
// chunk). Button reaches the manifest only through the fallback scan, and
// because Button imports CSS the fallback must collect the entry chunk
// group's extracted CSS file — the CSS branch on the fallback path.
import Button from './Button';

export const app = [Button];

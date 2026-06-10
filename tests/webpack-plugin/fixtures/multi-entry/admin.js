// Second entrypoint. It eagerly imports Button, so Button's module also
// sits in this entry's chunk — the manifest entry for Button must still
// list only Button's own client-reference chunk group, not admin's chunks.
import Button from './Button';

export const admin = [Button];

import { Card } from './Card.tsx';

// Mirror an SSR entry that reaches a client component through its normal
// application graph as well as through the plugin-created async wrapper.
export const app = Card;

import ClientButton from './ClientButton';

// Actually invoke the import so tree-shaking doesn't drop it.
// This mimics a realistic RSC entry that renders client components.
console.log(ClientButton());

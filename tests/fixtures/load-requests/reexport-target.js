// A plain module the load-request handler must read from disk when the stock
// node-loader asks for a module other than the one being transformed (it does
// this to resolve `export * from` chains in directive files).
export const forwardedWidget = 'forwarded-widget';

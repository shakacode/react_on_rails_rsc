/**
 * Shared constants between loader and plugin.
 *
 * Using a Symbol would be safer (no collision risk with other plugins adding
 * properties to the compilation), but strings make tests easier to assert on
 * and match webpack's own patterns (e.g., `compilation.dependencyFactories`).
 *
 * Change the key name if you suspect a collision; nothing in the public world
 * should be using this property.
 */

export const CLIENT_MODULES_KEY = '__rorRscClientModules';

import { BundleManifest } from './types';

/**
 * When both Component.server.ext and Component.client.ext exist with
 * "use client", the RSC bundle creates proxies whose $$id points to the
 * .server file URL. The client manifest has separate entries for both
 * variants, so serializeClientReference would resolve to the wrong
 * .server chunk.
 *
 * This function overwrites each .server entry with the corresponding
 * .client entry's data (module ID + chunks) when both exist, so the RSC
 * payload references the correct .client chunk.
 */
export function aliasServerToClientEntries(
  filePathToModuleMetadata: BundleManifest['filePathToModuleMetadata'],
): void {
  for (const fileUrl of Object.keys(filePathToModuleMetadata)) {
    const clientUrl = fileUrl.replace(/\.server(\.[^./]+)$/, '.client$1');
    if (clientUrl !== fileUrl && filePathToModuleMetadata[clientUrl] !== undefined) {
      filePathToModuleMetadata[fileUrl] = filePathToModuleMetadata[clientUrl];
    }
  }
}

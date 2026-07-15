#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  collectCodeFiles,
  headerLines,
  requiredHeaderLinesForContent,
  thirdPartyHeaderLines,
} = require('./license-header.cjs');

const rootDir = path.resolve(__dirname, '..');
const sourceDir = path.join(rootDir, 'src');
const sentinel = 'https://github.com/shakacode/react_on_rails_rsc/blob/main/LICENSE.md';
const header = `/**
${headerLines}/`;
const thirdPartyBridge = ' * The following notice applies to ShakaCode modifications:';

function normalizeLineEndings(content) {
  return content.replace(/\r\n/g, '\n');
}

function postShebangOffset(content) {
  return content.match(/^#![^\n]*(?:\n|$)/)?.[0].length ?? 0;
}

function leadingComment(content) {
  const offset = postShebangOffset(content);

  const firstBlock = content.slice(offset).match(/^\/\*\*?[\s\S]*?\*\//);
  if (!firstBlock) return null;

  return {
    start: offset,
    end: offset + firstBlock[0].length,
    block: firstBlock[0],
  };
}

function containsThirdPartyNotice(block) {
  return block.includes('Copyright (c) Meta Platforms');
}

function thirdPartyNoticeOnly(block) {
  const normalizedBlock = normalizeLineEndings(block);
  const rscNoticeMarkers = [
    /The\s+following\s+notice\s+applies\s+to\s+the\s+ShakaCode-owned\s+and\s+contributor\s+portions:/,
    /The\s+following\s+notice\s+applies\s+to\s+ShakaCode\s+modifications:/,
    /@license\s+React\s+on\s+Rails\s+RSC/,
    /Copyright\s+\(c\)[^\n]*ShakaCode\s+LLC[^\n]*React\s+on\s+Rails\s+RSC/,
  ];
  const noticeStarts = rscNoticeMarkers
    .map((pattern) => normalizedBlock.match(pattern)?.index)
    .filter((index) => index !== undefined);
  if (noticeStarts.length === 0) return block;

  const noticeStart = Math.min(...noticeStarts);
  const preserved = normalizedBlock
    .slice(0, noticeStart)
    .replace(/[ \t]+$/, '')
    .replace(/(?:\n[ \t]*\*)+[ \t]*$/, '')
    .trimEnd();
  return `${preserved}\n */`;
}

function combineWithThirdPartyNotice(block) {
  const preserved = thirdPartyNoticeOnly(block).replace(/[ \t\r\n]*\*\/$/, '');
  return `${preserved}\n *\n${thirdPartyBridge}\n *\n${thirdPartyHeaderLines}/`;
}

function applyHeader(content) {
  if (hasRequiredHeader(content)) return content;

  const comment = leadingComment(content);
  if (!comment) {
    const offset = postShebangOffset(content);
    return `${content.slice(0, offset)}${header}\n\n${content.slice(offset)}`;
  }

  if (containsThirdPartyNotice(comment.block)) {
    const combinedHeader = combineWithThirdPartyNotice(comment.block);
    return `${content.slice(0, comment.start)}${combinedHeader}${content.slice(comment.end)}`;
  }

  if (
    comment.block.includes(sentinel) ||
    comment.block.includes('@license React on Rails RSC') ||
    comment.block.includes('React on Rails RSC (commercial license)')
  ) {
    return `${content.slice(0, comment.start)}${header}${content.slice(comment.end)}`;
  }

  const offset = postShebangOffset(content);
  return `${content.slice(0, offset)}${header}\n\n${content.slice(offset)}`;
}

function hasRequiredHeader(content) {
  const comment = leadingComment(content);
  const normalizedContent = normalizeLineEndings(content);
  const normalizedComment = normalizeLineEndings(comment?.block ?? '');
  return (
    normalizedComment.startsWith('/**') &&
    normalizedComment.includes(requiredHeaderLinesForContent(normalizedContent))
  );
}

function selfTest() {
  const plain = "import value from './value';\n";
  const withHeader = applyHeader(plain);
  assert(withHeader.startsWith(header));
  assert(withHeader.endsWith(plain));
  assert.strictEqual(applyHeader(withHeader), withHeader);

  const metaNotice = '/**\n * @license React\n * Copyright (c) Meta Platforms, Inc.\n */\n\n';
  const withMetaNotice = applyHeader(`${metaNotice}${plain}`);
  assert(withMetaNotice.startsWith('/**\n * @license React\n * Copyright (c) Meta Platforms, Inc.'));
  assert(withMetaNotice.match(/^\/\*\*[\s\S]*?\*\//)[0].includes(sentinel));
  assert(withMetaNotice.endsWith(plain));

  const staleMetaHeader = withMetaNotice
    .replace('React on Rails Pro commercial terms', 'stale commercial terms')
    .replace(' * The following notice applies', ' *  The following notice applies')
    .replace(' * Copyright (c) 2025-2026 ShakaCode LLC', ' *  Copyright (c) 2025-2026 ShakaCode LLC');
  assert(!hasRequiredHeader(staleMetaHeader));
  const refreshedMetaHeader = applyHeader(staleMetaHeader);
  assert(refreshedMetaHeader.includes('Copyright (c) Meta Platforms, Inc.'));
  assert(hasRequiredHeader(refreshedMetaHeader));
  assert.strictEqual(refreshedMetaHeader.match(/Copyright \(c\) Meta Platforms/g).length, 1);
  assert.strictEqual(
    refreshedMetaHeader.match(/Copyright \(c\) 2025-2026 ShakaCode LLC/g).length,
    1
  );
  assert.strictEqual(refreshedMetaHeader.match(/The following notice applies/g).length, 1);

  const thirdPartySentinelNotice = metaNotice.replace(
    ' */',
    ` * ${sentinel}\n */`
  );
  const withThirdPartySentinel = applyHeader(`${thirdPartySentinelNotice}${plain}`);
  const thirdPartySentinelIndex = withThirdPartySentinel.indexOf(sentinel);
  const bridgeIndex = withThirdPartySentinel.indexOf(thirdPartyBridge);
  assert(thirdPartySentinelIndex >= 0);
  assert(bridgeIndex >= 0);
  assert(thirdPartySentinelIndex < bridgeIndex);

  const singleLineCombinedNotice =
    '/** @license React Copyright (c) Meta Platforms, Inc. @license React on Rails RSC */\n';
  const repairedSingleLineNotice = applyHeader(`${singleLineCombinedNotice}const value = 1;\n`);
  assert.doesNotThrow(() => new Function(repairedSingleLineNotice));
  assert(repairedSingleLineNotice.includes('Copyright (c) Meta Platforms, Inc.'));
  assert(hasRequiredHeader(repairedSingleLineNotice));

  const incompleteHeader = withHeader.replace(
    'This file is NOT licensed under the MIT (open source) license.',
    'This file has commercial terms.'
  );
  assert(!hasRequiredHeader(incompleteHeader));
  assert(hasRequiredHeader(applyHeader(incompleteHeader)));

  const crlfHeader = withHeader.replace(/\n/g, '\r\n');
  assert(hasRequiredHeader(crlfHeader));
  assert.strictEqual(applyHeader(crlfHeader), crlfHeader);

  const shebang = '#!/usr/bin/env node\n';
  const withShebang = applyHeader(`${shebang}${plain}`);
  assert(withShebang.startsWith(`${shebang}${header}`));
  assert(withShebang.endsWith(plain));

  console.log('License-header self-test passed.');
}

const args = new Set(process.argv.slice(2));
const supportedModes = new Set(['--check', '--fix', '--self-test']);
const unknownArgs = [...args].filter((arg) => !supportedModes.has(arg));
const selectedModes = [...args].filter((arg) => supportedModes.has(arg));
if (unknownArgs.length > 0 || selectedModes.length > 1) {
  console.error('Usage: check-license-headers.cjs [--check|--fix|--self-test]');
  process.exit(2);
}

const mode = selectedModes[0] ?? '--check';
if (mode === '--self-test') {
  selfTest();
  process.exit(0);
}

const files = collectCodeFiles(sourceDir);
const missing = files.filter((file) => !hasRequiredHeader(fs.readFileSync(file, 'utf8')));

if (mode === '--fix') {
  for (const file of missing) {
    fs.writeFileSync(file, applyHeader(fs.readFileSync(file, 'utf8')));
    console.log(`Added license header: ${path.relative(rootDir, file)}`);
  }
  console.log(`License headers present in ${files.length} source files.`);
  process.exit(0);
}

if (missing.length > 0) {
  console.error('Source files missing or using a stale react-on-rails-rsc license header:');
  for (const file of missing) console.error(`  - ${path.relative(rootDir, file)}`);
  console.error('Run `node scripts/check-license-headers.cjs --fix` to add them.');
  process.exit(1);
}

console.log(`License headers present in ${files.length} source files.`);

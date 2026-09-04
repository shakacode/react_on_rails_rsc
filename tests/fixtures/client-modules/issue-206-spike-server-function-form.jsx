/*
 * Regression fixture for issue #206.
 *
 * Reduced from `SpikeServerFunctionForm.jsx` in shakacode/react_on_rails
 * (react_on_rails_pro/spec/dummy, commit 702f27d3a). Parsing this file with
 * `acorn-loose` and the stock node-loader's options yields a body of
 * [ExpressionStatement, ImportDeclaration, ImportDeclaration,
 * VariableDeclaration] — the trailing `ExportDefaultDeclaration` is swallowed,
 * so the stock `transformClientModule` emitted an empty module and the
 * component silently disappeared from the RSC payload.
 *
 * Keep the JSX shape (the trailing `{cond && (<jsx/>)}` blocks in particular)
 * byte-for-byte; it is what triggers the loose-recovery failure.
 */

'use client';

import React, { useState } from 'react';
import { greet, addNumbers } from '../actions/spikeServerFunctions';

const SpikeServerFunctionForm = () => {
  const [name, setName] = useState('World');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  const run = async (label, invoke) => {
    setPending(true);
    setError(null);
    setResult(null);
    const startedAt = performance.now();
    try {
      const value = await invoke();
      setResult({ label, value, durationMs: Math.round(performance.now() - startedAt) });
    } catch (e) {
      setError(`${label} failed: ${e.message}`);
    } finally {
      setPending(false);
    }
  };

  return (
    <div style={{ border: '1px solid #ccc', borderRadius: 8, padding: 16, maxWidth: 560 }}>
      <h2>Client form calling server functions</h2>
      <label htmlFor="spike-name-input">
        Name:{' '}
        <input
          id="spike-name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ border: '1px solid #999', padding: 4 }}
        />
      </label>
      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button
          id="spike-call-greet"
          type="button"
          disabled={pending}
          onClick={() => run('greet', () => greet({ name }))}
        >
          Call greet(&#123;name&#125;)
        </button>
        <button
          id="spike-call-add"
          type="button"
          disabled={pending}
          onClick={() => run('addNumbers', () => addNumbers(20, 22))}
        >
          Call addNumbers(20, 22)
        </button>
      </div>
      {pending && <p id="spike-pending">Calling server function…</p>}
      {result && (
        <pre id="spike-result" style={{ background: '#f4f4f4', padding: 8, marginTop: 12 }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
      {error && (
        <p id="spike-error" style={{ color: 'red', marginTop: 12 }}>
          {error}
        </p>
      )}
    </div>
  );
};

export default SpikeServerFunctionForm;

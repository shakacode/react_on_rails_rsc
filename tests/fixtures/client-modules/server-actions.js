/*
 * `"use server"` fixture: these modules stay on the stock node-loader path, so
 * the loader must leave the original function bodies in place and must register
 * them as server references rather than rewriting them into client references.
 */

'use server';

export async function greet({ name }) {
  return `Hello, ${name}!`;
}

export async function addNumbers(a, b) {
  return a + b;
}

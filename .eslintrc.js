module.exports = {
  parser: '@typescript-eslint/parser',
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:jest/recommended',
    'prettier'
  ],
  plugins: ['@typescript-eslint', 'jest'],
  env: {
    node: true,
    jest: true
  },
  rules: {}
};

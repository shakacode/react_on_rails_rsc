// Test application transform: the wrapper's !! request must still see raw proposal syntax.
module.exports = function proposalSyntaxLoader(source) {
  return source.replace(/1 \|> # \+ 1/g, '2');
};

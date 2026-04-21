// Tests the directive detector on tricky inputs.
import single from './SingleQuote';
import doubleq from './DoubleQuote';
import semi from './WithSemicolon';
import nosemi from './NoSemicolon';
import leading from './LeadingWhitespace';
import comment from './DirectiveInComment';
import afterImport from './DirectiveAfterImport';

export default { single, doubleq, semi, nosemi, leading, comment, afterImport };

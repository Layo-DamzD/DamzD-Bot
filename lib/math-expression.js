function tokenize(input) {
  const source = String(input || "").trim();
  if (!source || source.length > 120) throw new Error("Enter a math expression under 120 characters.");
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1;
      continue;
    }
    const rest = source.slice(index);
    const number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
    if (number) {
      const value = Number(number[0]);
      if (!Number.isFinite(value)) throw new Error("The expression contains an invalid number.");
      tokens.push({ type: "number", value });
      index += number[0].length;
      continue;
    }
    const char = source[index];
    if ("+-*/%^()".includes(char)) {
      tokens.push({ type: char, value: char });
      index += 1;
      continue;
    }
    throw new Error("Unsupported character in expression: " + char);
  }
  return tokens;
}

export function calculateExpression(input) {
  const tokens = tokenize(input);
  let cursor = 0;
  const peek = () => tokens[cursor]?.type || "end";
  const take = type => {
    if (peek() !== type) throw new Error("Invalid math expression.");
    return tokens[cursor++];
  };
  const checked = value => {
    if (!Number.isFinite(value) || Math.abs(value) > 1e15) {
      throw new Error("The result is outside the supported numeric range.");
    }
    return value;
  };

  function primary() {
    if (peek() === "number") return checked(take("number").value);
    if (peek() === "(") {
      take("(");
      const value = expression();
      take(")");
      return value;
    }
    throw new Error("Expected a number or opening parenthesis.");
  }

  function unary() {
    if (peek() === "+") {
      take("+");
      return unary();
    }
    if (peek() === "-") {
      take("-");
      return -unary();
    }
    return primary();
  }

  function power() {
    const left = unary();
    if (peek() === "^") {
      take("^");
      return checked(left ** power());
    }
    return left;
  }

  function term() {
    let value = power();
    while (["*", "/", "%"].includes(peek())) {
      const operator = tokens[cursor++].type;
      const right = power();
      if ((operator === "/" || operator === "%") && right === 0) {
        throw new Error("Division by zero is not allowed.");
      }
      if (operator === "*") value *= right;
      else if (operator === "/") value /= right;
      else value %= right;
      value = checked(value);
    }
    return value;
  }

  function expression() {
    let value = term();
    while (peek() === "+" || peek() === "-") {
      const operator = tokens[cursor++].type;
      const right = term();
      value = checked(operator === "+" ? value + right : value - right);
    }
    return value;
  }

  const result = expression();
  if (peek() !== "end") throw new Error("Unexpected token in math expression.");
  return Number(checked(result).toPrecision(12));
}

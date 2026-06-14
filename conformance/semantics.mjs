const duplicates = (values) => {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
};

function validateArgs(args, scope, errors) {
  for (const name of duplicates(args.map((arg) => arg.name))) {
    errors.push(`${scope} duplicate argument name ${JSON.stringify(name)}`);
  }

  const flags = args.flatMap((arg) => arg.positional ? [] : arg.flags);
  for (const flag of duplicates(flags)) {
    errors.push(`${scope} duplicate option flag ${JSON.stringify(flag)}`);
  }

  for (const arg of args) {
    if (arg.positional) continue;
    if (!arg.flags.includes(arg.name)) {
      errors.push(`${scope}/${arg.name} option name must appear in flags`);
    }
    if ((arg.metavar !== undefined || arg.choices !== undefined) && !arg.takes_value) {
      errors.push(`${scope}/${arg.name} metavar or choices requires takes_value: true`);
    }
  }
}

function validateParas(paras, scope, errors) {
  for (let i = 0; i < paras.length; i += 1) {
    if (paras[i].trim().length === 0) {
      errors.push(`${scope}/${i} paragraph must not be empty`);
    } else if (/[\r\n]/.test(paras[i])) {
      errors.push(`${scope}/${i} paragraph must be one unwrapped logical paragraph`);
    }
  }
}

export function surfaceSemanticErrors(document) {
  const errors = [];

  for (const name of duplicates(document.commands.map((command) => command.name))) {
    errors.push(`/commands duplicate command name ${JSON.stringify(name)}`);
  }

  validateArgs(
    [...document.positionals, ...document.global_options],
    '/arguments',
    errors,
  );
  validateParas(document.paras, '/paras', errors);

  for (const command of document.commands) {
    const scope = `/commands/${command.name}`;
    validateArgs(command.args, `${scope}/args`, errors);
    validateParas(command.paras, `${scope}/paras`, errors);
  }

  return errors;
}

export function checksSemanticErrors(document) {
  const errors = [];
  const failing = document.checks
    .filter((check) => check.status === 'fail')
    .map((check) => check.id);

  for (const id of duplicates(document.checks.map((check) => check.id))) {
    errors.push(`/checks duplicate check id ${JSON.stringify(id)}`);
  }

  if (document.ok !== (failing.length === 0)) {
    errors.push('/ok must be true if and only if no check has status "fail"');
  }
  if (JSON.stringify(document.failed) !== JSON.stringify(failing)) {
    errors.push('/failed must exactly list failed check ids in checks order');
  }
  if (document.ok && document.report !== null) {
    errors.push('/report must be null when ok is true');
  }
  if (!document.ok && document.report === null) {
    errors.push('/report must name the failure report when ok is false');
  }
  if (typeof document.report === 'string' && document.report.startsWith('/')) {
    errors.push('/report must be a relative path');
  }

  return errors;
}

/**
 * Sample workbook in exactly the shape fetchWorkbook() returns, so "Load
 * sample" exercises the real parse/layout/render path with no network.
 *
 * Doubles as executable documentation of the tab schema.
 */

export const SAMPLE = {
  config: [
    { key: 'title', value: 'Developer Tooling Landscape' },
    { key: 'subtitle', value: 'Companies building for engineering teams' },
    { key: 'date', value: 'Q3 2026' },
    { key: 'footer', value: 'Illustrative sample data — not a real market map.' },
    { key: 'columns', value: '3' },
    { key: 'width', value: '1600' },
  ],

  categories: [
    { category: 'Source Control & Review', color: '#3b6fd4', order: '1',
      description: 'Where code lands' },
    { category: 'CI / CD', color: '#c2543c', order: '2',
      description: 'Build, test, ship' },
    { category: 'Observability', color: '#2f8f6b', order: '3',
      description: 'Knowing what broke' },
    { category: 'Developer Environments', color: '#8a5cb8', order: '4' },
    { category: 'Security & Compliance', color: '#c98a1e', order: '5' },
    { category: 'AI Coding Assistants', color: '#3d8ba8', order: '6', span: '2',
      description: 'The fastest-moving segment' },
  ],

  companies: [
    { company: 'GitHub', category: 'Source Control & Review', domain: 'github.com' },
    { company: 'GitLab', category: 'Source Control & Review', domain: 'gitlab.com' },
    { company: 'Bitbucket', category: 'Source Control & Review', domain: 'bitbucket.org' },
    { company: 'Graphite', category: 'Source Control & Review', domain: 'graphite.dev' },
    { company: 'Gerrit', category: 'Source Control & Review', domain: 'gerritcodereview.com' },

    { company: 'CircleCI', category: 'CI / CD', domain: 'circleci.com' },
    { company: 'Buildkite', category: 'CI / CD', domain: 'buildkite.com' },
    { company: 'Harness', category: 'CI / CD', domain: 'harness.io' },
    { company: 'Argo', category: 'CI / CD', domain: 'argoproj.github.io' },
    { company: 'Depot', category: 'CI / CD', domain: 'depot.dev' },

    { company: 'Datadog', category: 'Observability', domain: 'datadoghq.com' },
    { company: 'Grafana', category: 'Observability', domain: 'grafana.com' },
    { company: 'Honeycomb', category: 'Observability', domain: 'honeycomb.io' },
    { company: 'Sentry', category: 'Observability', domain: 'sentry.io' },
    { company: 'Chronosphere', category: 'Observability', domain: 'chronosphere.io' },
    { company: 'Axiom', category: 'Observability', domain: 'axiom.co' },

    { company: 'Coder', category: 'Developer Environments', domain: 'coder.com' },
    { company: 'Gitpod', category: 'Developer Environments', domain: 'gitpod.io' },
    { company: 'Daytona', category: 'Developer Environments', domain: 'daytona.io' },
    { company: 'Namespace', category: 'Developer Environments', domain: 'namespace.so' },

    { company: 'Snyk', category: 'Security & Compliance', domain: 'snyk.io' },
    { company: 'Semgrep', category: 'Security & Compliance', domain: 'semgrep.dev' },
    { company: 'Socket', category: 'Security & Compliance', domain: 'socket.dev' },
    { company: 'Chainguard', category: 'Security & Compliance', domain: 'chainguard.dev' },
    { company: 'Vanta', category: 'Security & Compliance', domain: 'vanta.com' },

    { company: 'Claude Code', category: 'AI Coding Assistants', domain: 'claude.com',
      emphasis: 'true' },
    { company: 'GitHub Copilot', category: 'AI Coding Assistants', domain: 'github.com' },
    { company: 'Cursor', category: 'AI Coding Assistants', domain: 'cursor.com' },
    { company: 'Codeium', category: 'AI Coding Assistants', domain: 'codeium.com' },
    { company: 'Sourcegraph', category: 'AI Coding Assistants', domain: 'sourcegraph.com' },
    { company: 'Tabnine', category: 'AI Coding Assistants', domain: 'tabnine.com' },
    { company: 'Replit', category: 'AI Coding Assistants', domain: 'replit.com' },
    { company: 'Augment', category: 'AI Coding Assistants', domain: 'augmentcode.com' },
  ],
};

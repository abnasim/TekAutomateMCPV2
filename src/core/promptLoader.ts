import fs from 'fs';

const DEFAULT_PROMPTS = {
  steps_json: new URL('../../prompts/steps_builder.md', import.meta.url),
  blockly_xml: new URL('../../prompts/blockly_builder.md', import.meta.url),
} as const;

function resolvePromptPath(pathValue: string): URL {
  return new URL(pathValue, new URL('../../', import.meta.url));
}

export function getPromptPath(outputMode: 'steps_json' | 'blockly_xml' | 'chat'): URL {
  if (outputMode === 'chat') {
    return DEFAULT_PROMPTS.steps_json;
  }
  const configured =
    outputMode === 'blockly_xml'
      ? process.env.TEKAUTOMATE_BLOCKLY_INSTRUCTIONS_FILE
      : process.env.TEKAUTOMATE_STEPS_INSTRUCTIONS_FILE;

  return configured ? resolvePromptPath(configured) : DEFAULT_PROMPTS[outputMode];
}

export function loadPromptText(outputMode: 'steps_json' | 'blockly_xml' | 'chat'): string {
  const path = getPromptPath(outputMode);
  if (!fs.existsSync(path)) {
    throw new Error(`Prompt file not found: ${path.pathname}`);
  }
  // eslint-disable-next-line no-console
  console.log(`[MCP] loading prompt for ${outputMode}: ${path.pathname}`);
  return fs.readFileSync(path, 'utf8').trim();
}

// Backwards-compatible alias expected by toolLoop edits.
export const loadPromptFile = loadPromptText;

import * as yaml from 'yaml';

export interface ParsedContent {
    frontmatter: Record<string, unknown>;
    content: string;
}

/**
 * Parse YAML or markdown with YAML frontmatter.
 * Accepts:
 * - Pure YAML documents
 * - Markdown with YAML frontmatter (---\n...\n---\n content)
 */
export function parseContent(text: string): ParsedContent {
    // Try markdown with YAML frontmatter first
    const frontmatterMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (frontmatterMatch) {
        const frontmatter = yaml.parse(frontmatterMatch[1]);
        const content = frontmatterMatch[2].trim();
        return { frontmatter, content };
    }

    // Try pure YAML (no frontmatter delimiters)
    try {
        const parsed = yaml.parse(text);
        if (typeof parsed === 'object' && parsed !== null) {
            return { frontmatter: parsed, content: '' };
        }
    } catch {
        // Not valid YAML either
    }

    throw new Error('Invalid format: expected YAML or markdown with YAML frontmatter');
}

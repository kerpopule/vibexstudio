import { Fragment } from 'react';
import { Linking, StyleSheet, View, type TextStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { parseMarkdown, type Block, type Inline } from '@/lib/markdown';

/**
 * Renders chat markdown with native text — bold, italic, inline code, links,
 * headings, fenced code blocks, lists, and quotes.
 */
export function Markdown({ text, baseColor }: { text: string; baseColor?: string }) {
  const theme = useTheme();
  const blocks = parseMarkdown(text);
  const color = baseColor ?? theme.text;

  return (
    <View style={styles.root}>
      {blocks.map((block, i) => (
        <Fragment key={i}>{renderBlock(block, i, color, theme)}</Fragment>
      ))}
    </View>
  );
}

type Theme = ReturnType<typeof useTheme>;

function renderBlock(block: Block, key: number, color: string, theme: Theme) {
  switch (block.type) {
    case 'heading':
      return (
        <ThemedText
          key={key}
          style={[styles.heading, { color, fontSize: block.level <= 2 ? 20 : 17 }]}>
          <InlineRun nodes={block.content} color={color} theme={theme} />
        </ThemedText>
      );
    case 'code':
      return (
        <View key={key} style={[styles.codeBlock, { backgroundColor: theme.backgroundSelected }]}>
          <ThemedText type="code" style={{ color: theme.text }}>
            {block.text}
          </ThemedText>
        </View>
      );
    case 'list':
      return (
        <View key={key} style={styles.list}>
          {block.items.map((item, j) => (
            <View key={j} style={styles.listItem}>
              <ThemedText style={[styles.bullet, { color: theme.tint }]}>
                {block.ordered ? `${j + 1}.` : '•'}
              </ThemedText>
              <ThemedText style={[styles.listText, { color }]}>
                <InlineRun nodes={item} color={color} theme={theme} />
              </ThemedText>
            </View>
          ))}
        </View>
      );
    case 'quote':
      return (
        <View key={key} style={[styles.quote, { borderLeftColor: theme.tint }]}>
          <ThemedText style={{ color: theme.textSecondary }}>
            <InlineRun nodes={block.content} color={theme.textSecondary} theme={theme} />
          </ThemedText>
        </View>
      );
    case 'paragraph':
      return (
        <ThemedText key={key} style={{ color }}>
          <InlineRun nodes={block.content} color={color} theme={theme} />
        </ThemedText>
      );
  }
}

function InlineRun({ nodes, color, theme }: { nodes: Inline[]; color: string; theme: Theme }) {
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.type) {
          case 'text':
            return <Fragment key={i}>{node.text}</Fragment>;
          case 'bold':
            return (
              <ThemedText key={i} style={[styles.bold, { color }]}>
                <InlineRun nodes={node.children} color={color} theme={theme} />
              </ThemedText>
            );
          case 'italic':
            return (
              <ThemedText key={i} style={[styles.italic, { color }]}>
                <InlineRun nodes={node.children} color={color} theme={theme} />
              </ThemedText>
            );
          case 'code':
            return (
              <ThemedText
                key={i}
                style={[styles.inlineCode, { color: theme.tint, backgroundColor: theme.backgroundSelected }]}>
                {node.text}
              </ThemedText>
            );
          case 'link':
            return (
              <ThemedText
                key={i}
                style={[styles.link, { color: theme.tint }]}
                onPress={() => Linking.openURL(node.href).catch(() => {})}>
                {node.text}
              </ThemedText>
            );
        }
      })}
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: Spacing.two,
  },
  heading: {
    fontFamily: Fonts.rounded,
    fontWeight: 700 as TextStyle['fontWeight'],
    lineHeight: 26,
  },
  codeBlock: {
    borderRadius: Radii.sm,
    padding: Spacing.two + 2,
  },
  list: {
    gap: 5,
  },
  listItem: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  bullet: {
    fontWeight: 700 as TextStyle['fontWeight'],
    lineHeight: 24,
  },
  listText: {
    flex: 1,
  },
  quote: {
    borderLeftWidth: 3,
    paddingLeft: Spacing.two + 2,
  },
  bold: {
    fontWeight: 700 as TextStyle['fontWeight'],
  },
  italic: {
    fontStyle: 'italic',
  },
  inlineCode: {
    fontFamily: Fonts.mono,
    fontSize: 14,
  },
  link: {
    textDecorationLine: 'underline',
  },
});

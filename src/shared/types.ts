/** Persisted store shape — source of truth in inline-review.json */
export interface ReviewStore {
  version: 1;
  annotations: Annotation[];
  pageNotes: PageNote[];
}

/** A reply from an agent (via MCP) or a reviewer (via panel UI) */
export interface AgentReply {
  message: string;
  createdAt: string;
  role?: 'agent' | 'reviewer';
}

/** Annotation lifecycle status */
export type AnnotationStatus = 'open' | 'in_progress' | 'addressed';

/** Shared fields for all annotation types */
export interface BaseAnnotation {
  id: string;
  type: 'text' | 'element';
  pageUrl: string;
  pageTitle: string;
  note: string;
  createdAt: string;
  updatedAt: string;
  status?: AnnotationStatus;
  inProgressAt?: string;
  addressedAt?: string;
  resolvedAt?: string;
  replies?: AgentReply[];
}

/**
 * Get the effective status of an annotation.
 * Handles backward compatibility: annotations without a status field
 * derive from timestamps. Legacy 'resolved' status maps to 'addressed'.
 */
export function getAnnotationStatus(a: BaseAnnotation): AnnotationStatus {
  if (a.status) {
    // Backward compat: legacy 'resolved' maps to 'addressed'
    if ((a.status as string) === 'resolved') return 'addressed';
    return a.status;
  }
  // Legacy annotations without status field: derive from timestamps
  if (a.resolvedAt) return 'addressed';
  if (a.inProgressAt) return 'in_progress';
  return 'open';
}

/** Check whether an annotation is in a terminal/non-editable agent state */
export function isAgentWorking(a: BaseAnnotation): boolean {
  return getAnnotationStatus(a) === 'in_progress';
}

/** A text selection annotation */
export interface TextAnnotation extends BaseAnnotation {
  type: 'text';
  selectedText: string;
  range: SerializedRange;
  replacedText?: string;
}

/** Describes how to locate an annotated element */
export interface ElementSelector {
  cssSelector: string;
  xpath: string;
  description: string;
  tagName: string;
  attributes: Record<string, string>;
  outerHtmlPreview: string;
}

/** An element annotation (Alt+click) */
export interface ElementAnnotation extends BaseAnnotation {
  type: 'element';
  elementSelector: ElementSelector;
}

/** Discriminated union — all annotation types */
export type Annotation = TextAnnotation | ElementAnnotation;

export interface PageNote {
  id: string;
  pageUrl: string;
  pageTitle: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface SerializedRange {
  startXPath: string;
  startOffset: number;
  endXPath: string;
  endOffset: number;
  selectedText: string;
  contextBefore: string;
  contextAfter: string;
}

export function createEmptyStore(): ReviewStore {
  return { version: 1, annotations: [], pageNotes: [] };
}

/** Type guard for text annotations */
export function isTextAnnotation(a: Annotation): a is TextAnnotation {
  return a.type === 'text';
}

/** Type guard for element annotations */
export function isElementAnnotation(a: Annotation): a is ElementAnnotation {
  return a.type === 'element';
}

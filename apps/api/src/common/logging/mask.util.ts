import { CODE_MASK_CHAR, CODE_VISIBLE_PREFIX_LEN, CODE_VISIBLE_SUFFIX_LEN } from './logging.constants';

export function maskCode(code: string): string {
  return code
    .split('-')
    .map((segment, index, segments) => maskSegment(segment, index, segments.length))
    .join('-');
}

function maskSegment(segment: string, index: number, totalSegments: number): string {
  if (segment.length === 0) {
    return segment;
  }

  const isFirst = index === 0;
  const isLast = index === totalSegments - 1;

  return segment
    .split('')
    .map((char, charIndex) => {
      const keepAsPrefix = isFirst && charIndex < CODE_VISIBLE_PREFIX_LEN;
      const keepAsSuffix = isLast && charIndex >= segment.length - CODE_VISIBLE_SUFFIX_LEN;

      return keepAsPrefix || keepAsSuffix ? char : CODE_MASK_CHAR;
    })
    .join('');
}

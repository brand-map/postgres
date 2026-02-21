function capitalize(word: string) {
  return word.length === 0 ? "" : word.charAt(0).toUpperCase() + word.slice(1)
}

function splitWords(input: string) {
  const normalized = input
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-\s.]+/g, " ")
    .trim()

  if (normalized.length === 0) {
    return [] as string[]
  }

  return normalized
    .split(" ")
    .filter(part => part.length > 0)
    .map(part => part.toLowerCase())
}

export function camelCase(input: string) {
  const words = splitWords(input)

  if (words.length === 0) {
    return ""
  }

  const [head = "", ...tail] = words
  return head + tail.map(capitalize).join("")
}

export function pascalCase(input: string) {
  return splitWords(input).map(capitalize).join("")
}

package main

import (
	"fmt"
	"strings"
)

func countWords(text string) map[string]int {
	words := strings.Fields(strings.ToLower(text))
	result := make(map[string]int)

	for _, word := range words {
		result[word]++
	}

	return result
}

func main() {
	text := "Go is great and Go is fast"
	counts := countWords(text)

	fmt.Println(counts)
}
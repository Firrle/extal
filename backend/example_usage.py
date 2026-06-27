#!/usr/bin/env python3
"""
Example usage of the auto-scanner with detailed demonstrations
"""

import sys
import os
import json

# Add the backend directory to path
sys.path.insert(0, os.path.dirname(__file__))

from auto_scanner import VaultScanner


def example_basic_scan():
    """Example 1: Basic scan without AI"""
    print("="*70)
    print("EXAMPLE 1: Basic Rule-Based Scanning")
    print("="*70)
    
    # Sample text
    sample_text = """
    In the year 1450, King Aldric the Brave led his forces against the dark 
    sorcerer Malachar. The Battle of Thornfield would decide the fate of the 
    Kingdom of Eredane. Queen Elara remained in the capital city of Silverhaven, 
    preparing defenses should the battle be lost.
    
    The war had begun in 1448, when Malachar emerged from the Shadow Mountains 
    seeking the ancient artifact known as the Crystal of Souls. Lord Brennan, 
    the King's advisor, warned that dark magic was growing stronger.
    """
    
    # Initialize scanner
    scanner = VaultScanner("backend/extal_vault.json")
    
    # Scan the text
    results = scanner.scan_text(sample_text, use_ai=False)
    
    # Display results
    print("\nCharacters Found:")
    for char in results['characters']:
        print(f"  • {char.name}")
        if char.titles:
            print(f"    Titles: {', '.join(char.titles)}")
        print(f"    Confidence: {char.confidence:.2f}")
        print(f"    Mentions: {char.mentions}")
    
    print("\nEvents Found:")
    for event in results['events']:
        print(f"  • {event.name}")
        if event.date:
            print(f"    Date: {event.date}")
        print(f"    Confidence: {event.confidence:.2f}")
    
    print("\nTopics Found:")
    for topic in results['topics']:
        print(f"  • {topic.name}")
        print(f"    Keywords: {', '.join(list(topic.keywords)[:5])}")
        print(f"    Frequency: {topic.frequency}")
    
    print("\nLocations Found:")
    for loc in results['locations']:
        print(f"  • {loc.name}")
        print(f"    Mentions: {loc.mentions}")
    
    return results


def example_with_suggestions():
    """Example 2: Generate actionable suggestions"""
    print("\n" + "="*70)
    print("EXAMPLE 2: Generating Actionable Suggestions")
    print("="*70)
    
    sample_text = """
    Duke Marcus of Westmarch traveled to the great Library of Aetherion to 
    consult with the sage Theodric. The year was 2150, marking the beginning 
    of the Age of Enlightenment. Magic had begun to return to the world after 
    centuries of dormancy.
    """
    
    scanner = VaultScanner("backend/extal_vault.json")
    results = scanner.scan_text(sample_text)
    suggestions = scanner.generate_suggestions(results)
    
    print("\nSuggestions for New Characters:")
    for char in suggestions['new_characters']:
        print(f"  • {char['name']}")
        print(f"    First Name: {char['firstName']}")
        print(f"    Last Name: {char['lastName']}")
        if char['titles']:
            print(f"    Titles: {', '.join(char['titles'])}")
        if char['gender']:
            print(f"    Suggested Gender: {char['gender']}")
        print(f"    Confidence: {char['confidence']:.2f}")
        print()
    
    print("Suggestions for New Topics:")
    for topic in suggestions['new_topics']:
        print(f"  • {topic['name']}")
        print(f"    Keywords: {', '.join(topic['keywords'][:5])}")
        print()
    
    print("Suggestions for New Events:")
    for event in suggestions['new_events']:
        print(f"  • {event['name']}")
        if event['date']:
            print(f"    Date: {event['date']}")
        print()


def example_match_existing():
    """Example 3: Match against existing vault entries"""
    print("\n" + "="*70)
    print("EXAMPLE 3: Matching Existing Vault Entries")
    print("="*70)
    
    # This text mentions characters and places already in the vault
    sample_text = """
    King Joshua met with Ravage in the ancient city of Sarsda. They discussed 
    the ongoing conflict in Elise and the mysterious happenings in Eden. 
    Queen Anna joined them, bringing news from the Whiteface Mountains.
    The Geography of the region was changing, and the Magic that once flowed 
    freely was now unpredictable.
    """
    
    scanner = VaultScanner("backend/extal_vault.json")
    results = scanner.scan_text(sample_text)
    
    print("\nExisting Characters Mentioned:")
    for char in results['matches']['characters']:
        print(f"  • {char['name']} (ID: {char['id']})")
        print(f"    Mentioned {char['mentions']} time(s)")
    
    print("\nExisting Topics Mentioned:")
    for topic in results['matches']['topics']:
        print(f"  • {topic['name']} (ID: {topic['id']})")
        print(f"    Mentioned {topic['mentions']} time(s)")


def example_full_workflow():
    """Example 4: Complete workflow with file output"""
    print("\n" + "="*70)
    print("EXAMPLE 4: Complete Workflow with JSON Output")
    print("="*70)
    
    # Read the sample text file
    with open("backend/sample_text.txt", 'r', encoding='utf-8') as f:
        text = f.read()
    
    print("\nScanning sample_text.txt...")
    
    scanner = VaultScanner("backend/extal_vault.json")
    results = scanner.scan_text(text, use_ai=False)
    
    # Save to file
    output_file = "backend/example_scan_results.json"
    full_results = scanner.save_results(results, output_file)
    
    print(f"\nResults saved to: {output_file}")
    print("\nSummary:")
    print(f"  Characters extracted: {len(results['characters'])}")
    print(f"  Events extracted: {len(results['events'])}")
    print(f"  Topics identified: {len(results['topics'])}")
    print(f"  Locations found: {len(results['locations'])}")
    print(f"\n  New characters suggested: {len(full_results['suggestions']['new_characters'])}")
    print(f"  New events suggested: {len(full_results['suggestions']['new_events'])}")
    print(f"  New topics suggested: {len(full_results['suggestions']['new_topics'])}")
    print(f"  Link suggestions: {len(full_results['suggestions']['link_suggestions'])}")
    
    # Show a few specific suggestions
    print("\n  Top Character Suggestions:")
    for char in full_results['suggestions']['new_characters'][:3]:
        print(f"    • {char['name']} (confidence: {char['confidence']:.2f})")
    
    print("\n  Top Topic Suggestions:")
    for topic in full_results['suggestions']['new_topics'][:3]:
        print(f"    • {topic['name']} (frequency: {topic['frequency']})")


def example_ai_enhanced():
    """Example 5: AI-enhanced extraction (if configured)"""
    print("\n" + "="*70)
    print("EXAMPLE 5: AI-Enhanced Extraction")
    print("="*70)
    
    sample_text = """
    Captain Sarah Blackwood commanded the airship Stormchaser. Her crew consisted 
    of the engineer Tom Riley and the navigator Ada Chen. They were searching for 
    the lost city of Atlantara, which legend said sank beneath the waves in 
    ancient times.
    """
    
    scanner = VaultScanner("backend/extal_vault.json")
    results = scanner.scan_text(sample_text, use_ai=True)
    
    if 'ai_enhanced' in results:
        print("\nAI Enhancement Status:")
        if 'error' in results['ai_enhanced']:
            print(f"  Status: {results['ai_enhanced'].get('method', 'Unknown')}")
            print(f"  Note: {results['ai_enhanced'].get('note', '')}")
            if 'options' in results['ai_enhanced']:
                print("\n  Available options:")
                for option in results['ai_enhanced']['options']:
                    print(f"    {option}")
        else:
            print(f"  Method: {results['ai_enhanced']['method']}")
            print(f"  Characters found: {len(results['ai_enhanced'].get('characters', []))}")
            print(f"  Locations found: {len(results['ai_enhanced'].get('locations', []))}")
            print(f"  Dates found: {len(results['ai_enhanced'].get('dates', []))}")
    
    print("\nRule-based extraction still works:")
    print(f"  Characters: {len(results['characters'])}")
    print(f"  Topics: {len(results['topics'])}")


def main():
    """Run all examples"""
    print("\n" + "🔍 AUTO-SCANNER EXAMPLES 🔍".center(70))
    print()
    
    try:
        # Run examples
        example_basic_scan()
        example_with_suggestions()
        example_match_existing()
        example_full_workflow()
        example_ai_enhanced()
        
        print("\n" + "="*70)
        print("All examples completed!")
        print("="*70)
        print("\nNext steps:")
        print("  1. Review the generated example_scan_results.json file")
        print("  2. Try scanning your own documents:")
        print("     python backend/auto_scanner.py your_document.txt")
        print("  3. For AI enhancement, install one of the optional dependencies:")
        print("     pip install spacy")
        print("     python -m spacy download en_core_web_sm")
        
    except FileNotFoundError as e:
        print(f"\n❌ Error: {e}")
        print("Make sure you're running this from the project root directory")
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()

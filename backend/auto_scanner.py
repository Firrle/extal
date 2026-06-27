#!/usr/bin/env python3
"""
Extal Auto-Scanner: Automatically extract and suggest worldbuilding entities
from text documents using rule-based pattern matching.

✓ FULLY SELF-CONTAINED - No external dependencies required
✓ Uses only Python standard library (json, re, typing, dataclasses, datetime, os)
✓ No pip packages needed
✓ No API keys needed
✓ Works completely offline

The scanner uses sophisticated regex patterns to detect:
- Characters (with titles, gender inference, first/last name parsing)
- Timeline events (with date extraction)
- Topics/themes (with contextual descriptions)
- Locations (kingdoms, cities, geographic features)
"""

import json
import re
from typing import Dict, List, Set, Tuple, Optional
from dataclasses import dataclass, field, asdict
from datetime import datetime
import os


@dataclass
class ExtractedCharacter:
    """Represents a character extracted from text"""
    name: str
    mentions: int = 1
    contexts: List[str] = field(default_factory=list)
    titles: Set[str] = field(default_factory=set)
    confidence: float = 0.0
    suggested_race: str = ""
    suggested_gender: str = ""
    first_name: str = ""
    last_name: str = ""
    
    def to_dict(self):
        d = asdict(self)
        d['titles'] = list(d['titles'])
        return d


@dataclass
class ExtractedEvent:
    """Represents a timeline event extracted from text"""
    name: str
    date: str
    end_date: str = ""
    description: str = ""
    confidence: float = 0.0
    
    def to_dict(self):
        return asdict(self)


@dataclass
class ExtractedTopic:
    """Represents a topic/category extracted from text"""
    name: str
    keywords: Set[str] = field(default_factory=set)
    frequency: int = 1
    confidence: float = 0.0
    suggested_parent: str = ""
    description: str = ''
    
    def to_dict(self):
        d = asdict(self)
        d['keywords'] = list(d['keywords'])
        return d


@dataclass
class ExtractedLocation:
    """Represents a location extracted from text"""
    name: str
    mentions: int = 1
    description: str = ""
    confidence: float = 0.0
    
    def to_dict(self):
        return asdict(self)


class VaultScanner:
    """Main scanner class that coordinates extraction"""
    
    # Common English words that should not be extracted as proper nouns
    COMMON_WORDS = {
        'but', 'and', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'from',
        'with', 'by', 'about', 'or', 'not', 'this', 'that', 'these', 'those', 'i',
        'you', 'he', 'she', 'it', 'we', 'they', 'what', 'who', 'which', 'why', 'how',
        'is', 'was', 'are', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
        'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must',
        'can', 'just', 'only', 'also', 'as', 'if', 'because', 'while', 'when', 'where',
        'now', 'then', 'here', 'there', 'up', 'down', 'out', 'over', 'under', 'before',
        'after', 'during', 'through', 'throughout', 'above', 'below', 'between', 'among',
        'all', 'each', 'every', 'both', 'neither', 'either', 'one', 'some', 'any',
        'nobody', 'anybody', 'everybody', 'nothing', 'something', 'anything', 'everything',
        'someone', 'anyone', 'everyone', 'myself', 'yourself', 'himself', 'herself',
        'itself', 'ourselves', 'yourselves', 'themselves', 'me', 'him', 'her', 'us', 'them',
        'my', 'your', 'his', 'her', 'its', 'our', 'their', 'mine', 'yours', 'his', 'hers',
        'ours', 'theirs', 'very', 'much', 'many', 'more', 'most', 'less', 'least', 'few',
        'several', 'such', 'same', 'other', 'another', 'such', 'way', 'time', 'thing',
        'day', 'year', 'life', 'people', 'man', 'woman', 'child', 'person', 'world',
        'hand', 'head', 'eye', 'ear', 'face', 'foot', 'body', 'heart', 'mind', 'soul',
        'get', 'got', 'make', 'made', 'go', 'went', 'come', 'came', 'say', 'said',
        'tell', 'told', 'give', 'gave', 'take', 'took', 'know', 'knew', 'think', 'thought',
        'find', 'found', 'feel', 'felt', 'see', 'saw', 'hear', 'heard', 'look', 'looked',
        'want', 'wanted', 'need', 'needed', 'like', 'liked', 'use', 'used', 'work', 'worked',
        'call', 'called', 'ask', 'asked', 'show', 'showed', 'help', 'helped', 'let', 'put',
        'seem', 'seemed', 'keep', 'kept', 'hold', 'held', 'turn', 'turned', 'start', 'started',
        'run', 'ran', 'walk', 'walked', 'stop', 'stopped', 'follow', 'followed', 'lead', 'led',
        'meet', 'met', 'talk', 'talked', 'try', 'tried', 'fall', 'fell', 'break', 'broke',
        'right', 'left', 'good', 'bad', 'big', 'small', 'large', 'little', 'high', 'low',
        'hot', 'cold', 'warm', 'cool', 'fast', 'slow', 'hard', 'soft', 'easy', 'difficult',
        'new', 'old', 'young', 'long', 'short', 'near', 'far', 'early', 'late', 'dark',
        'light', 'bright', 'beautiful', 'ugly', 'strong', 'weak', 'sick', 'well', 'dead',
        'alive', 'true', 'false', 'real', 'fake', 'public', 'private', 'open', 'closed',
        'yes', 'no', 'ok', 'okay', 'well', 'now', 'then', 'today', 'tonight', 'tomorrow',
        'yesterday', 'tonight', 'morning', 'afternoon', 'evening', 'night', 'dawn', 'dusk',
        'spring', 'summer', 'autumn', 'fall', 'winter', 'monday', 'tuesday', 'wednesday',
        'thursday', 'friday', 'saturday', 'sunday', 'january', 'february', 'march', 'april',
        'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
    }
    
    def __init__(self, vault_path: str):
        """Initialize scanner with existing vault data"""
        self.vault_path = vault_path
        self.vault_data = self._load_vault()
        
        # Compile regex patterns
        self._compile_patterns()
    
    def _load_vault(self) -> Dict:
        """Load existing vault data"""
        if os.path.exists(self.vault_path):
            with open(self.vault_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        return {"topics": {}, "characters": {}, "events": {}, "maps": {}}
    
    def _compile_patterns(self):
        """Compile regex patterns for extraction"""
        # Character title patterns
        self.title_patterns = [
            r'\b(King|Queen|Prince|Princess|Duke|Duchess|Lord|Lady|Sir|Dame)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)',
            r'\b(Captain|Marshal|General|Commander|Swordmaster|Master)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)',
            r'\b(Archmage|Wizard|Witch|Sorcerer|Mage)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)',
        ]
        
        # Date/year patterns
        self.date_patterns = [
            r'\b(\d{4})\b',  # Simple year: 1201
            r'\b(circa|c\.|ca\.)\s*(\d+)',  # Circa dates
            r'\bAge of ([A-Z][a-z\s]+)',  # Age of Something
            r'\b([A-Z][a-z]+)\s+Age\b',  # Something Age
            r'\b(\d+)(?:st|nd|rd|th)\s+(?:year|century)',  # Ordinal dates
            r'\byear\s+(\d+)',  # year 1234
        ]
        
        # Location patterns
        self.location_patterns = [
            r'\b(?:Kingdom|Empire|Republic|Realm|Land|Nation)\s+of\s+([A-Z][a-z]+)',
            r'\b(?:City|Town|Village|Port)\s+of\s+([A-Z][a-z]+)',
            r'\b([A-Z][a-z]+)\s+(?:Mountains|Mountain|Range|Sea|Ocean|River|Forest)',
            r'\bthe\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:Mountains|Forest|Sea|River)',
        ]
        
        # Topic/theme keywords
        self.topic_keywords = {
            'Magic': ['magic', 'magical', 'spell', 'enchant', 'arcane', 'mana', 'wizard', 'sorcery'],
            'War': ['war', 'battle', 'conflict', 'invasion', 'siege', 'army', 'soldier'],
            'Politics': ['kingdom', 'empire', 'throne', 'council', 'treaty', 'alliance', 'govern'],
            'Religion': ['god', 'goddess', 'divine', 'temple', 'priest', 'worship', 'faith'],
            'Geography': ['mountain', 'river', 'sea', 'ocean', 'forest', 'plain', 'continent', 'island'],
            'Technology': ['forge', 'craft', 'smith', 'engineer', 'invention', 'weapon', 'armor'],
            'Culture': ['festival', 'tradition', 'custom', 'culture', 'art', 'music', 'language'],
            'Economy': ['trade', 'merchant', 'gold', 'coin', 'market', 'guild', 'commerce'],
        }
    
    def scan_text(self, text: str, use_ai: bool = False, model_file: str = None) -> Dict:
        """
        Scan text and extract all entities
        
        Args:
            text: The text to scan
            use_ai: Whether to use AI-enhanced extraction (requires setup)
            model_file: Specific GGUF model file to use (optional)
        
        Returns:
            Dictionary with extracted characters, events, topics, locations
        """
        results = {
            'characters': self._extract_characters_rule_based(text),
            'events': self._extract_events_rule_based(text),
            'topics': self._extract_topics_rule_based(text),
            'locations': self._extract_locations_rule_based(text),
            'matches': self._match_existing_entities(text),
        }
        
        if use_ai:
            ai_results = self._extract_with_ai(text, model_file=model_file)
            results['ai_enhanced'] = ai_results
        
        return results
    
    def _parse_name_parts(self, full_name: str) -> tuple:
        """Parse a full name into first and last name"""
        parts = full_name.strip().split()
        
        if len(parts) == 1:
            return parts[0], ''
        elif len(parts) == 2:
            return parts[0], parts[1]
        else:
            # For 3+ parts, first is first name, rest is last name
            return parts[0], ' '.join(parts[1:])
    
    def _is_valid_name(self, name: str) -> bool:
        """Check if a name is valid (not a common English word)"""
        if not name or len(name) < 2:
            return False
        
        # Check if it's a common word (case-insensitive)
        lower_name = name.lower()
        if lower_name in self.COMMON_WORDS:
            return False
        
        # Names should have at least one capital letter or be all-caps (for acronyms)
        if not any(c.isupper() for c in name):
            return False
        
        return True
    
    def _extract_characters_rule_based(self, text: str) -> List[ExtractedCharacter]:
        """Extract character names using rule-based patterns"""
        characters = {}
        
        # Extract titled characters
        for pattern in self.title_patterns:
            matches = re.finditer(pattern, text)
            for match in matches:
                title = match.group(1)
                name = match.group(2)
                
                if name not in characters:
                    first_name, last_name = self._parse_name_parts(name)
                    characters[name] = ExtractedCharacter(
                        name=name,
                        contexts=[match.group(0)],
                        titles={title},
                        confidence=0.9  # High confidence for titled characters
                    )
                    characters[name].first_name = first_name
                    characters[name].last_name = last_name
                else:
                    characters[name].mentions += 1
                    characters[name].titles.add(title)
                    characters[name].contexts.append(match.group(0))
        
        # Extract proper nouns (capitalized words) that might be names
        # More conservative approach - look for 2-3 capitalized words
        proper_noun_pattern = r'\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b'
        matches = re.finditer(proper_noun_pattern, text)
        
        for match in matches:
            name = match.group(1)
            
            # Use the comprehensive common words filter
            if not self._is_valid_name(name) or name in characters:
                continue
            
            # Check if surrounded by character-like context
            context_start = max(0, match.start() - 30)
            context_end = min(len(text), match.end() + 30)
            context = text[context_start:context_end]
            
            # Look for character indicators
            character_indicators = ['said', 'spoke', 'told', 'asked', 'replied', 'thought', 
                                   'knew', 'saw', 'went', 'came', 'left', 'arrived']
            
            has_indicator = any(indicator in context.lower() for indicator in character_indicators)
            
            if name not in characters and has_indicator:
                first_name, last_name = self._parse_name_parts(name)
                characters[name] = ExtractedCharacter(
                    name=name,
                    contexts=[context.strip()],
                    confidence=0.5  # Medium confidence for non-titled names
                )
                characters[name].first_name = first_name
                characters[name].last_name = last_name
            elif name in characters:
                characters[name].mentions += 1
        
        # Infer gender from titles
        for char in characters.values():
            if any(t in ['King', 'Prince', 'Duke', 'Lord', 'Sir'] for t in char.titles):
                char.suggested_gender = 'Male'
            elif any(t in ['Queen', 'Princess', 'Duchess', 'Lady', 'Dame'] for t in char.titles):
                char.suggested_gender = 'Female'
        
        # Sort by confidence and mentions
        return sorted(characters.values(), key=lambda x: (x.confidence, x.mentions), reverse=True)
    
    def _extract_events_rule_based(self, text: str) -> List[ExtractedEvent]:
        """Extract timeline events using rule-based patterns"""
        events = []
        
        # Extract named historical events
        event_pattern = r'\b(War|Battle|Age|Era|Period|Reign|Rise|Fall|Founding|Destruction)\s+of\s+([A-Z][a-z\s]+?)(?=\.|,|\s-|$|\n)'
        matches = re.finditer(event_pattern, text, re.MULTILINE)
        
        for match in matches:
            event_type = match.group(1)
            event_name = match.group(2).strip()
            full_name = f"{event_type} of {event_name}"
            
            # Try to find associated dates nearby
            context_start = max(0, match.start() - 100)
            context_end = min(len(text), match.end() + 100)
            context = text[context_start:context_end]
            
            date = ""
            for date_pattern in self.date_patterns:
                date_match = re.search(date_pattern, context)
                if date_match:
                    date = date_match.group(1) if date_match.lastindex == 1 else date_match.group(2)
                    break
            
            events.append(ExtractedEvent(
                name=full_name,
                date=date,
                description=context.strip(),
                confidence=0.8
            ))
        
        # Extract standalone dates with context
        sentences = re.split(r'[.!?]+', text)
        for sentence in sentences:
            for date_pattern in self.date_patterns:
                date_match = re.search(date_pattern, sentence)
                if date_match:
                    date = date_match.group(1) if date_match.lastindex == 1 else date_match.group(2)
                    
                    # Use sentence as event description
                    desc = sentence.strip()
                    if len(desc) > 20:  # Only if substantial
                        # Try to extract event name from sentence
                        words = desc.split()
                        event_name = ' '.join(words[:5]) + '...' if len(words) > 5 else desc
                        
                        events.append(ExtractedEvent(
                            name=event_name,
                            date=str(date),
                            description=desc,
                            confidence=0.6
                        ))
        
        # Remove duplicates and sort by confidence
        unique_events = {}
        for event in events:
            key = (event.name, event.date)
            if key not in unique_events or unique_events[key].confidence < event.confidence:
                unique_events[key] = event
        
        return sorted(unique_events.values(), key=lambda x: x.confidence, reverse=True)
    
    def _extract_topic_description(self, text: str, keywords: set, topic_name: str) -> str:
        """Extract a description for a topic based on surrounding context"""
        text_lower = text.lower()
        sentences = re.split(r'[.!?]+', text)
        relevant_sentences = []
        
        # Find sentences containing topic keywords
        for sentence in sentences:
            sentence_lower = sentence.lower()
            if any(keyword in sentence_lower for keyword in keywords):
                relevant_sentences.append(sentence.strip())
                if len(relevant_sentences) >= 2:
                    break
        
        if relevant_sentences:
            description = '. '.join(relevant_sentences[:2])
            return description if len(description) > 10 else f"Related to {', '.join(list(keywords)[:3])}"
        else:
            return f"Related to {', '.join(list(keywords)[:3])}"
    
    def _extract_topics_rule_based(self, text: str) -> List[ExtractedTopic]:
        """Extract topics and categories using keyword matching"""
        topics = {}
        text_lower = text.lower()
        
        # Count keyword frequencies for each topic
        for topic_name, keywords in self.topic_keywords.items():
            total_count = 0
            found_keywords = set()
            
            for keyword in keywords:
                count = len(re.findall(r'\b' + re.escape(keyword) + r'\w*\b', text_lower))
                if count > 0:
                    total_count += count
                    found_keywords.add(keyword)
            
            if total_count > 0:
                # Calculate confidence based on frequency and diversity of keywords
                confidence = min(0.9, (total_count / 100) + (len(found_keywords) / len(keywords)))
                
                # Generate description from context
                description = self._extract_topic_description(text, found_keywords, topic_name)
                
                topics[topic_name] = ExtractedTopic(
                    name=topic_name,
                    keywords=found_keywords,
                    frequency=total_count,
                    confidence=confidence
                )
                topics[topic_name].description = description
        
        # Try to suggest parent topics based on existing vault structure
        for topic in topics.values():
            for vault_topic_id, vault_topic in self.vault_data.get('topics', {}).items():
                if vault_topic['name'].lower() in text_lower:
                    topic.suggested_parent = vault_topic['name']
                    break
        
        return sorted(topics.values(), key=lambda x: (x.confidence, x.frequency), reverse=True)
    
    def _extract_locations_rule_based(self, text: str) -> List[ExtractedLocation]:
        """Extract location names using rule-based patterns"""
        locations = {}
        
        # Extract locations from patterns
        for pattern in self.location_patterns:
            matches = re.finditer(pattern, text)
            for match in matches:
                # Get the location name (last capture group)
                name = match.group(match.lastindex)
                
                if name not in locations:
                    # Get context
                    context_start = max(0, match.start() - 50)
                    context_end = min(len(text), match.end() + 50)
                    context = text[context_start:context_end].strip()
                    
                    locations[name] = ExtractedLocation(
                        name=name,
                        description=context,
                        confidence=0.8
                    )
                else:
                    locations[name].mentions += 1
        
        # Also check for capitalized place names already in the vault
        for map_id, map_data in self.vault_data.get('maps', {}).items():
            for marker in map_data.get('markers', []):
                marker_name = marker.get('name', '')
                if marker_name and marker_name in text:
                    count = text.count(marker_name)
                    if marker_name not in locations:
                        locations[marker_name] = ExtractedLocation(
                            name=marker_name,
                            mentions=count,
                            confidence=0.95  # High confidence - already in vault
                        )
        
        return sorted(locations.values(), key=lambda x: (x.confidence, x.mentions), reverse=True)
    
    def _match_existing_entities(self, text: str) -> Dict:
        """Match text against existing vault entities"""
        matches = {
            'characters': [],
            'topics': [],
            'events': [],
            'locations': []
        }
        
        # Match existing characters
        for char_id, char_data in self.vault_data.get('characters', {}).items():
            name = char_data.get('name', '')
            if name and name in text:
                count = text.count(name)
                matches['characters'].append({
                    'id': char_id,
                    'name': name,
                    'mentions': count,
                    'type': 'existing'
                })
        
        # Match existing topics
        for topic_id, topic_data in self.vault_data.get('topics', {}).items():
            name = topic_data.get('name', '')
            if name and name.lower() in text.lower():
                count = len(re.findall(r'\b' + re.escape(name) + r'\b', text, re.IGNORECASE))
                matches['topics'].append({
                    'id': topic_id,
                    'name': name,
                    'mentions': count,
                    'type': 'existing'
                })
        
        # Match existing events
        for event_id, event_data in self.vault_data.get('events', {}).items():
            name = event_data.get('name', '')
            if name and name in text:
                count = text.count(name)
                matches['events'].append({
                    'id': event_id,
                    'name': name,
                    'mentions': count,
                    'type': 'existing'
                })
        
        return matches
    
    def _extract_with_ai(self, text: str, model_file: str = None) -> Dict:
        """
        Enhanced extraction using local AI model if available.
        
        Args:
            text: Text to scan
            model_file: Specific model filename to use (optional)
        
        Checks for GGUF model files in backend/models/ directory.
        Falls back to rule-based extraction if no model found.
        """
        # Try to use local GGUF model first (fully self-contained)
        try:
            local_result = self._extract_with_local_llm(text, model_file=model_file)
            if local_result and 'error' not in local_result:
                return local_result
            else:
                print(f"ERROR: AI extraction returned error: {local_result}")
                return local_result  # Return the error so we can see it
        except Exception as e:
            print(f"EXCEPTION in _extract_with_ai: {e}")
            import traceback
            traceback.print_exc()
            return {
                'method': 'Rule-based only (exception caught)',
                'error': str(e)
            }
        
        # No AI available - return empty result
        return {
            'method': 'Rule-based only (no local AI model available)'
        }
    
    def _extract_with_local_llm(self, text: str, model_file: str = None) -> Dict:
        """Extract entities using a local GGUF language model"""
        try:
            from llama_cpp import Llama
            
            # Look for GGUF model files in backend/models/
            models_dir = os.path.join(os.path.dirname(__file__), 'models')
            print(f"DEBUG: Looking for models in: {models_dir}")
            print(f"DEBUG: Models directory exists: {os.path.exists(models_dir)}")
            
            if not os.path.exists(models_dir):
                return {'error': 'No models directory found', 'path': models_dir}
            
            # Use specified model or find first .gguf file
            if model_file:
                model_path = os.path.join(models_dir, model_file)
                print(f"DEBUG: Looking for specified model: {model_path}")
                print(f"DEBUG: Model file exists: {os.path.exists(model_path)}")
                if not os.path.exists(model_path):
                    return {'error': f'Specified model not found: {model_file}', 'path': model_path}
                model_name = model_file  # Store the model name for later
            else:
                model_files = [f for f in os.listdir(models_dir) if f.endswith('.gguf')]
                print(f"DEBUG: Found {len(model_files)} .gguf files: {model_files}")
                if not model_files:
                    return {'error': 'No .gguf model files found in backend/models/'}
                model_path = os.path.join(models_dir, model_files[0])
                model_name = model_files[0]  # Store the model name for later
            
            print(f"DEBUG: Loading model from: {model_path}")
            
            # Load model (use smaller context for speed)
            llm = Llama(
                model_path=model_path,
                n_ctx=2048,  # Context window
                n_threads=4,  # CPU threads
                n_gpu_layers=0,  # Set to >0 if you have GPU
                verbose=False  # Suppress llama.cpp output
            )
            
            print("DEBUG: Model loaded successfully!")
            
            # Truncate text if too long
            if len(text) > 800:
                text = text[:800] + "..."
            
            # Ultra-simplified prompt for reliable JSON generation
            prompt = f"""Extract names from this text and return ONLY a JSON object with no extra text. No explanations, no markdown, just JSON.

Output format EXACTLY like this:
{{"characters": [{{"name": "John", "description": "A person", "context": "John walked away."}}], "locations": [{{"name": "London", "description": "A city", "context": "He went to London."}}], "events": [], "topics": []}}

Text to analyze:
{text}

Output JSON only:"""
            
            # Generate response
            response = llm(
                prompt,
                max_tokens=1024,
                temperature=0.1,
                stop=["\n\nText:", "End JSON"]
            )
            
            # Parse response
            response_text = response['choices'][0]['text'].strip()
            
            print(f"DEBUG: Raw AI response (first 500 chars):\n{response_text[:500]}\n")
            
            # Extract ONLY the first complete JSON object by counting braces
            try:
                # Find the start of JSON
                start_idx = response_text.find('{')
                if start_idx == -1:
                    raise ValueError("No JSON object found in response")
                
                # Count braces to find the matching closing brace
                brace_count = 0
                end_idx = -1
                for i in range(start_idx, len(response_text)):
                    if response_text[i] == '{':
                        brace_count += 1
                    elif response_text[i] == '}':
                        brace_count -= 1
                        if brace_count == 0:
                            end_idx = i + 1
                            break
                
                if end_idx == -1:
                    raise ValueError("No matching closing brace found")
                
                # Extract ONLY the JSON, ignore everything after
                response_text = response_text[start_idx:end_idx]
                print(f"DEBUG: Extracted first JSON object (length: {len(response_text)})")
                print(f"DEBUG: Cleaned response:\n{response_text}\n")
                
                # Parse JSON with aggressive error recovery
                try:
                    raw_result = json.loads(response_text)
                    print(f"DEBUG: Successfully parsed JSON on first try")
                except json.JSONDecodeError as e:
                    print(f"DEBUG: JSON parse failed with error: {str(e)}")
                    print(f"DEBUG: Full cleaned response:\n{response_text}\n")
                    print(f"DEBUG: Attempting multiple fixes...")
                    
                    # Try multiple fixes in sequence
                    attempts = [
                        ("Single quotes to double", lambda x: x.replace("'", '"')),
                        ("Remove backslashes", lambda x: x.replace('\\', '')),
                        ("Clean newlines", lambda x: x.replace('\n', ' ').replace('\r', '')),
                        ("Remove trailing commas", lambda x: x.replace(',}', '}').replace(',]', ']')),
                        ("Fix adjacent braces", lambda x: x.replace('}{', '},{') if x.count('}') == x.count('{') else x),
                        ("Encode unicode properly", lambda x: x.encode('utf-8', errors='ignore').decode('utf-8')),
                    ]
                    
                    raw_result = None
                    for fix_name, fix_fn in attempts:
                        try:
                            test_text = fix_fn(response_text)
                            raw_result = json.loads(test_text)
                            print(f"DEBUG: Fix '{fix_name}' worked!")
                            response_text = test_text
                            break
                        except Exception as fix_err:
                            print(f"DEBUG: Fix '{fix_name}' failed: {str(fix_err)[:100]}")
                            continue
                    
                    if raw_result is None:
                        # All fixes failed
                        print(f"DEBUG: All JSON fixes failed, returning empty result")
                        return {
                            'characters': [],
                            'events': [],
                            'locations': [],
                            'topics': [],
                            'method': f'Local LLM ({model_name}) - parsing failed',
                            'error': 'Model response was not valid JSON'
                        }
                
                # Normalize - ensure we have the expected structure
                result = {
                    'characters': [],
                    'events': [],
                    'locations': [],
                    'topics': [],
                    'method': f'Local LLM ({model_name})'
                }
                
                # Extract characters (handle both singular and plural)
                chars = raw_result.get('characters') or raw_result.get('character')
                if chars:
                    if isinstance(chars, list):
                        # Convert string names or objects to proper format with description
                        result['characters'] = []
                        for c in chars:
                            if isinstance(c, str):
                                result['characters'].append({'name': c, 'title': '', 'gender': '', 'description': '', 'context': ''})
                            else:
                                result['characters'].append({
                                    'name': c.get('name', ''),
                                    'title': c.get('title', ''),
                                    'gender': c.get('gender', ''),
                                    'description': c.get('description', ''),
                                    'context': c.get('context', '')
                                })
                    elif isinstance(chars, str):
                        result['characters'] = [{'name': chars, 'title': '', 'gender': '', 'description': '', 'context': ''}]
                
                # Extract locations (handle both singular and plural)
                locs = raw_result.get('locations') or raw_result.get('location')
                if locs:
                    if isinstance(locs, list):
                        result['locations'] = []
                        for l in locs:
                            if isinstance(l, str):
                                result['locations'].append({'name': l, 'type': '', 'description': '', 'context': ''})
                            else:
                                result['locations'].append({
                                    'name': l.get('name', ''),
                                    'type': l.get('type', ''),
                                    'description': l.get('description', ''),
                                    'context': l.get('context', '')
                                })
                    elif isinstance(locs, str):
                        result['locations'] = [{'name': locs, 'type': '', 'description': '', 'context': ''}]
                
                # Events (handle both singular and plural)
                events = raw_result.get('events') or raw_result.get('event')
                if events:
                    if isinstance(events, list):
                        result['events'] = []
                        for e in events:
                            if isinstance(e, str):
                                result['events'].append({'name': e, 'description': '', 'context': ''})
                            else:
                                result['events'].append({
                                    'name': e.get('name', ''),
                                    'description': e.get('description', ''),
                                    'date': e.get('date', ''),
                                    'context': e.get('context', '')
                                })
                    else:
                        result['events'] = [events] if isinstance(events, dict) else [{'name': events, 'description': '', 'context': ''}]
                
                # Topics (handle both singular and plural)
                topics = raw_result.get('topics') or raw_result.get('topic')
                if topics:
                    if isinstance(topics, list):
                        result['topics'] = []
                        for t in topics:
                            if isinstance(t, str):
                                result['topics'].append({'name': t, 'description': '', 'context': ''})
                            else:
                                result['topics'].append({
                                    'name': t.get('name', ''),
                                    'description': t.get('description', ''),
                                    'context': t.get('context', '')
                                })
                    else:
                        result['topics'] = [topics] if isinstance(topics, dict) else [{'name': topics, 'description': '', 'context': ''}]
                
                # Filter out common words from all categories
                result['characters'] = [c for c in result['characters'] if self._is_valid_name(c.get('name', ''))]
                result['locations'] = [l for l in result['locations'] if self._is_valid_name(l.get('name', ''))]
                result['events'] = [e for e in result['events'] if self._is_valid_name(e.get('name', ''))]
                result['topics'] = [t for t in result['topics'] if self._is_valid_name(t.get('name', ''))]
                
                print(f"DEBUG: Successfully parsed AI results! Found {len(result['characters'])} characters, {len(result['locations'])} locations, {len(result['events'])} events, {len(result['topics'])} topics")
                return result
                
            except json.JSONDecodeError:
                return {
                    'method': 'Local LLM (parse error)',
                    'error': 'Could not parse model response as JSON',
                    'raw_response': response_text[:200]
                }
                
        except ImportError as e:
            print(f"ERROR: llama-cpp-python import failed: {e}")
            return {
                'error': 'llama-cpp-python not installed',
                'note': 'Run: pip install llama-cpp-python'
            }
        except Exception as e:
            print(f"ERROR: Local LLM failed: {e}")
            import traceback
            traceback.print_exc()
            return {
                'error': f'Local LLM error: {str(e)}'
            }
    
    def _extract_with_spacy(self, text: str) -> Dict:
        """Extract entities using spaCy NER"""
        try:
            import spacy
            
            # Try to load model
            try:
                nlp = spacy.load("en_core_web_sm")
            except OSError:
                return {
                    'method': 'spaCy',
                    'error': 'Model not found. Run: python -m spacy download en_core_web_sm'
                }
            
            doc = nlp(text)
            
            characters = []
            locations = []
            dates = []
            
            for ent in doc.ents:
                if ent.label_ == "PERSON":
                    characters.append({
                        'name': ent.text,
                        'confidence': 0.85,
                        'method': 'spaCy NER'
                    })
                elif ent.label_ in ["GPE", "LOC", "FAC"]:
                    locations.append({
                        'name': ent.text,
                        'type': ent.label_,
                        'confidence': 0.85,
                        'method': 'spaCy NER'
                    })
                elif ent.label_ == "DATE":
                    dates.append({
                        'text': ent.text,
                        'confidence': 0.85,
                        'method': 'spaCy NER'
                    })
            
            return {
                'method': 'spaCy NER',
                'characters': characters,
                'locations': locations,
                'dates': dates
            }
            
        except Exception as e:
            return {'method': 'spaCy', 'error': str(e)}
    
    def _extract_with_openai(self, text: str) -> Dict:
        """Extract entities using OpenAI GPT"""
        try:
            import openai
            
            client = openai.OpenAI(api_key=os.getenv('OPENAI_API_KEY'))
            
            prompt = f"""Analyze this worldbuilding text and extract:
1. Character names (with titles if any)
2. Timeline events (with dates if mentioned)
3. Topics/themes
4. Locations

Text:
{text[:2000]}  # Limit to avoid token limits

Return the results in JSON format with the structure:
{{
    "characters": [{{"name": "...", "titles": [], "gender": ""}}],
    "events": [{{"name": "...", "date": "", "description": ""}}],
    "topics": [{{"name": "...", "keywords": []}}],
    "locations": [{{"name": "...", "description": ""}}]
}}"""
            
            response = client.chat.completions.create(
                model="gpt-4",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3
            )
            
            result = json.loads(response.choices[0].message.content)
            result['method'] = 'OpenAI GPT-4'
            return result
            
        except Exception as e:
            return {'method': 'OpenAI', 'error': str(e)}
    
    def _extract_with_anthropic(self, text: str) -> Dict:
        """Extract entities using Anthropic Claude"""
        try:
            import anthropic
            
            client = anthropic.Anthropic(api_key=os.getenv('ANTHROPIC_API_KEY'))
            
            prompt = f"""Analyze this worldbuilding text and extract:
1. Character names (with titles if any)
2. Timeline events (with dates if mentioned)
3. Topics/themes
4. Locations

Text:
{text[:2000]}

Return the results in JSON format with the structure:
{{
    "characters": [{{"name": "...", "titles": [], "gender": ""}}],
    "events": [{{"name": "...", "date": "", "description": ""}}],
    "topics": [{{"name": "...", "keywords": []}}],
    "locations": [{{"name": "...", "description": ""}}]
}}"""
            
            message = client.messages.create(
                model="claude-3-5-sonnet-20241022",
                max_tokens=1024,
                messages=[{"role": "user", "content": prompt}]
            )
            
            result = json.loads(message.content[0].text)
            result['method'] = 'Anthropic Claude'
            return result
            
        except Exception as e:
            return {'method': 'Anthropic', 'error': str(e)}
    
    def generate_suggestions(self, results: Dict) -> Dict:
        """Generate actionable suggestions from scan results"""
        suggestions = {
            'new_characters': [],
            'new_events': [],
            'new_topics': [],
            'new_locations': [],
            'link_suggestions': []
        }

        def _already_suggested(name: str, bucket: list) -> bool:
            """Check if a name already exists in a suggestions bucket"""
            lower_name = name.lower()
            return any(item.get('name', '').lower() == lower_name for item in bucket)
        
        # Suggest new characters (exclude those already in vault)
        existing_char_names = {c.get('name', '') for c in self.vault_data.get('characters', {}).values()}
        for char in results['characters']:
            if char.name not in existing_char_names and char.confidence > 0.3:
                suggestions['new_characters'].append({
                    'name': char.name,
                    'firstName': char.first_name,
                    'lastName': char.last_name,
                    'titles': list(char.titles),
                    'gender': char.suggested_gender,
                    'confidence': char.confidence,
                    'mentions': char.mentions
                })
        
        # Suggest new events
        existing_event_names = {e.get('name', '') for e in self.vault_data.get('events', {}).values()}
        for event in results['events']:
            if event.name not in existing_event_names and event.confidence > 0.4:
                suggestions['new_events'].append({
                    'name': event.name,
                    'date': event.date,
                    'endDate': event.end_date,
                    'description': event.description,
                    'confidence': event.confidence
                })
        
        # Suggest new topics
        existing_topic_names = {t.get('name', '') for t in self.vault_data.get('topics', {}).values()}
        for topic in results['topics']:
            if topic.name not in existing_topic_names and topic.confidence > 0.3:
                suggestions['new_topics'].append({
                    'name': topic.name,
                    'keywords': list(topic.keywords),
                    'frequency': topic.frequency,
                    'confidence': topic.confidence,
                    'suggestedParent': topic.suggested_parent,
                    'description': topic.description
                })
        
        # Suggest new locations
        for location in results['locations']:
            if location.confidence > 0.4:
                suggestions['new_locations'].append({
                    'name': location.name,
                    'description': location.description,
                    'mentions': location.mentions,
                    'confidence': location.confidence
                })

        # Merge AI-enhanced results when available (skip on errors)
        ai_data = results.get('ai_enhanced') or {}
        if isinstance(ai_data, dict) and not ai_data.get('error'):
            ai_method_confidence = float(ai_data.get('confidence', 0.6))

            # Characters from AI
            for char in ai_data.get('characters', []) or []:
                name = (char.get('name') or '').strip()
                if not name:
                    continue
                if name in existing_char_names or _already_suggested(name, suggestions['new_characters']):
                    continue
                first, last = self._parse_name_parts(name)
                titles = char.get('titles') or char.get('title') or []
                if isinstance(titles, str):
                    titles = [titles] if titles else []

                suggestions['new_characters'].append({
                    'name': name,
                    'firstName': first,
                    'lastName': last,
                    'titles': titles,
                    'gender': char.get('gender', ''),
                    'confidence': float(char.get('confidence', ai_method_confidence)),
                    'mentions': int(char.get('mentions', 0)),
                    'description': char.get('description', '')
                })

            # Events from AI
            for event in ai_data.get('events', []) or []:
                name = (event.get('name') or '').strip()
                if not name:
                    continue
                if name in existing_event_names or _already_suggested(name, suggestions['new_events']):
                    continue
                suggestions['new_events'].append({
                    'name': name,
                    'date': event.get('date', ''),
                    'endDate': event.get('endDate', ''),
                    'description': event.get('description', ''),
                    'confidence': float(event.get('confidence', ai_method_confidence))
                })

            # Topics from AI
            for topic in ai_data.get('topics', []) or []:
                name = (topic.get('name') or '').strip()
                if not name:
                    continue
                if name in existing_topic_names or _already_suggested(name, suggestions['new_topics']):
                    continue
                keywords = topic.get('keywords') or []
                if isinstance(keywords, str):
                    keywords = [keywords]
                suggestions['new_topics'].append({
                    'name': name,
                    'keywords': keywords,
                    'frequency': int(topic.get('frequency', 0)),
                    'confidence': float(topic.get('confidence', ai_method_confidence)),
                    'suggestedParent': topic.get('suggested_parent', ''),
                    'description': topic.get('description', '')
                })

            # Locations from AI
            for loc in ai_data.get('locations', []) or []:
                name = (loc.get('name') or '').strip()
                if not name:
                    continue
                if _already_suggested(name, suggestions['new_locations']):
                    continue
                suggestions['new_locations'].append({
                    'name': name,
                    'description': loc.get('description', ''),
                    'mentions': int(loc.get('mentions', 0)),
                    'confidence': float(loc.get('confidence', ai_method_confidence))
                })
        
        # Generate link suggestions
        if results['matches']:
            match_type_map = {
                'characters': 'character',
                'topics': 'topic',
                'events': 'event',
                'locations': 'location',
            }
            for bucket, link_type in match_type_map.items():
                for match in results['matches'].get(bucket, []):
                    if match.get('mentions', 0) <= 0:
                        continue
                    suggestions['link_suggestions'].append({
                        'type': link_type,
                        'id': match.get('id', ''),
                        'name': match.get('name', ''),
                        'reason': f"Mentioned {match.get('mentions', 0)} times in document"
                    })

        return suggestions
    
    def save_results(self, results: Dict, output_path: str):
        """Save scan results to JSON file"""
        # Convert dataclass objects to dictionaries
        serializable_results = {
            'characters': [c.to_dict() for c in results['characters']],
            'events': [e.to_dict() for e in results['events']],
            'topics': [t.to_dict() for t in results['topics']],
            'locations': [l.to_dict() for l in results['locations']],
            'matches': results['matches'],
        }
        
        if 'ai_enhanced' in results:
            serializable_results['ai_enhanced'] = results['ai_enhanced']
        
        # Add suggestions
        serializable_results['suggestions'] = self.generate_suggestions(results)
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(serializable_results, f, indent=2, ensure_ascii=False)
        
        return serializable_results


def main():
    """Example usage"""
    import sys
    
    # Default paths
    vault_path = "backend/extal_vault.json"
    
    if len(sys.argv) < 2:
        print("Usage: python auto_scanner.py <text_file> [--ai] [--model <model_file>] [--output <output_file>]")
        print("\nExample:")
        print("  python auto_scanner.py my_story.txt")
        print("  python auto_scanner.py my_story.txt --ai --model tinyllama.gguf --output results.json")
        return
    
    text_file = sys.argv[1]
    use_ai = '--ai' in sys.argv
    
    model_file = None
    if '--model' in sys.argv:
        model_idx = sys.argv.index('--model')
        if model_idx + 1 < len(sys.argv):
            model_file = sys.argv[model_idx + 1]
    
    output_file = "scan_results.json"
    if '--output' in sys.argv:
        output_idx = sys.argv.index('--output')
        if output_idx + 1 < len(sys.argv):
            output_file = sys.argv[output_idx + 1]
    
    # Read text file
    try:
        with open(text_file, 'r', encoding='utf-8') as f:
            text = f.read()
    except FileNotFoundError:
        print(f"Error: File '{text_file}' not found")
        return
    
    # Initialize scanner
    print(f"Loading vault from {vault_path}...")
    scanner = VaultScanner(vault_path)
    
    # Scan text
    print(f"\nScanning text from {text_file}...")
    print(f"AI enhancement: {'Enabled' if use_ai else 'Disabled'}")
    if use_ai and model_file:
        print(f"Model: {model_file}")
    
    results = scanner.scan_text(text, use_ai=use_ai, model_file=model_file)
    
    # Print summary
    print("\n" + "="*60)
    print("SCAN RESULTS")
    print("="*60)
    
    print(f"\n📝 Characters found: {len(results['characters'])}")
    for char in results['characters'][:5]:  # Show top 5
        titles = f" ({', '.join(char.titles)})" if char.titles else ""
        print(f"  • {char.name}{titles} - {char.mentions} mentions, confidence: {char.confidence:.2f}")
    
    print(f"\n📅 Events found: {len(results['events'])}")
    for event in results['events'][:5]:
        date_str = f" [{event.date}]" if event.date else ""
        print(f"  • {event.name}{date_str} - confidence: {event.confidence:.2f}")
    
    print(f"\n🏷️  Topics found: {len(results['topics'])}")
    for topic in results['topics'][:5]:
        print(f"  • {topic.name} - {topic.frequency} mentions, confidence: {topic.confidence:.2f}")
    
    print(f"\n🗺️  Locations found: {len(results['locations'])}")
    for loc in results['locations'][:5]:
        print(f"  • {loc.name} - {loc.mentions} mentions, confidence: {loc.confidence:.2f}")
    
    print(f"\n🔗 Existing entity matches:")
    print(f"  • Characters: {len(results['matches']['characters'])}")
    print(f"  • Topics: {len(results['matches']['topics'])}")
    print(f"  • Events: {len(results['matches']['events'])}")
    
    # Save results
    print(f"\nSaving detailed results to {output_file}...")
    full_results = scanner.save_results(results, output_file)
    
    print(f"\n✅ Scan complete!")
    print(f"\n💡 Suggestions generated:")
    print(f"  • New characters to add: {len(full_results['suggestions']['new_characters'])}")
    print(f"  • New events to add: {len(full_results['suggestions']['new_events'])}")
    print(f"  • New topics to add: {len(full_results['suggestions']['new_topics'])}")
    print(f"  • New locations to add: {len(full_results['suggestions']['new_locations'])}")
    print(f"  • Link suggestions: {len(full_results['suggestions']['link_suggestions'])}")


if __name__ == "__main__":
    main()

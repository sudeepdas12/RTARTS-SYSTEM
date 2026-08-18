import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { SearchService } from '@/lib/services/search.service';

export function GlobalSearch() {
  const [query, setQuery] = useState('');
  
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query) return;
    
    // Using the search service stub
    const results = await SearchService.globalSearch(query);
    console.log('Search Results:', results);
    // Real implementation would open a command palette or navigate to a search results page
    alert(`Found ${results.clients.length} clients and ${results.companies.length} companies matching "${query}"`);
  };

  return (
    <form onSubmit={handleSearch} className="relative w-full max-w-sm">
      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        type="search"
        placeholder="Search BOID, Name, ISIN..."
        className="pl-8 bg-background/50 focus-visible:ring-1 focus-visible:ring-primary h-9"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
    </form>
  );
}

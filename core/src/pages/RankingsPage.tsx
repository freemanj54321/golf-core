import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore';
import { useQuery } from '@tanstack/react-query';
import { Search, ChevronDown, ChevronUp, ChevronsLeft, ChevronsRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { useGolfCoreDb } from '../contexts/GolfCoreContext';
import { useYear } from '../contexts/YearContext';
import { GolfRanking } from '../types';

type FirestoreNumber = number | { '$numberInt'?: string; '$numberDouble'?: string };

const getSafeNumber = (value: FirestoreNumber): number => {
  if (typeof value === 'object' && value !== null) {
    if (value['$numberInt']) return parseInt(value['$numberInt'], 10);
    if (value['$numberDouble']) return parseFloat(value['$numberDouble']);
  }
  return Number(value || 0);
};

const ITEMS_PER_PAGE = 50;

export const RankingsPage: React.FC = () => {
  const db = useGolfCoreDb();
  const { year, setYear, availableYears } = useYear();
  const [filteredRankings, setFilteredRankings] = useState<GolfRanking[]>([]);
  const [currentRankings, setCurrentRankings] = useState<GolfRanking[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: keyof GolfRanking; direction: 'ascending' | 'descending' } | null>({ key: 'rank', direction: 'ascending' });
  const [currentPage, setCurrentPage] = useState(1);

  const { data: allRankings = [], isLoading: loading, error } = useQuery({
    queryKey: ['golf-core-rankings', year],
    queryFn: async () => {
      const q = query(
        collection(db, 'golf-rankings'),
        where('year', '==', year),
        orderBy('rank', 'asc')
      );
      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          rank: getSafeNumber(data.rank),
          fullName: data.fullName,
          country: data.country,
          year: getSafeNumber(data.year),
          totalPoints: getSafeNumber(data.totalPoints),
          rankingChange: data.rankingChange,
        } as GolfRanking;
      });
    },
    enabled: !!year && year !== 0,
  });

  const sortedAndFilteredRankings = useMemo(() => {
    let rankings = [...allRankings];
    if (searchTerm) {
      rankings = rankings.filter(p => p.fullName.toLowerCase().includes(searchTerm.toLowerCase()));
    }
    if (sortConfig !== null) {
      rankings.sort((a, b) => {
        const aValue = a[sortConfig.key];
        const bValue = b[sortConfig.key];
        if (aValue === undefined || aValue === null) return 1;
        if (bValue === undefined || bValue === null) return -1;
        if (aValue < bValue) return sortConfig.direction === 'ascending' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'ascending' ? 1 : -1;
        return 0;
      });
    }
    return rankings;
  }, [allRankings, searchTerm, sortConfig]);

  useEffect(() => {
    setFilteredRankings(sortedAndFilteredRankings);
    setCurrentPage(1);
  }, [sortedAndFilteredRankings]);

  useEffect(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    setCurrentRankings(filteredRankings.slice(startIndex, startIndex + ITEMS_PER_PAGE));
  }, [currentPage, filteredRankings]);

  const totalPages = Math.ceil(filteredRankings.length / ITEMS_PER_PAGE);

  const requestSort = (key: keyof GolfRanking) => {
    let direction: 'ascending' | 'descending' = 'ascending';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  };

  const getSortIcon = (key: keyof GolfRanking) => {
    if (!sortConfig || sortConfig.key !== key) return <ChevronDown className="h-4 w-4 ml-1 opacity-25" />;
    return sortConfig.direction === 'ascending' ? <ChevronUp className="h-4 w-4 ml-1" /> : <ChevronDown className="h-4 w-4 ml-1" />;
  };

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) setCurrentPage(newPage);
  };

  const renderPagination = () => {
    const pageNumbers: (number | string)[] = [];
    const maxPagesToShow = 5;
    if (totalPages <= maxPagesToShow) {
      for (let i = 1; i <= totalPages; i++) pageNumbers.push(i);
    } else {
      let startPage = Math.max(1, currentPage - Math.floor(maxPagesToShow / 2));
      let endPage = startPage + maxPagesToShow - 1;
      if (endPage > totalPages) { endPage = totalPages; startPage = endPage - maxPagesToShow + 1; }
      if (startPage > 1) { pageNumbers.push(1); if (startPage > 2) pageNumbers.push('...'); }
      for (let i = startPage; i <= endPage; i++) pageNumbers.push(i);
      if (endPage < totalPages) { if (endPage < totalPages - 1) pageNumbers.push('...'); pageNumbers.push(totalPages); }
    }
    return (
      <div className="flex items-center justify-center space-x-2 mt-4">
        <button onClick={() => handlePageChange(1)} disabled={currentPage === 1} className="pagination-button"><ChevronsLeft className="h-4 w-4" /></button>
        <button onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1} className="pagination-button"><ChevronLeft className="h-4 w-4" /></button>
        {pageNumbers.map((num, index) => (
          typeof num === 'number' ? (
            <button key={`page-${num}`} onClick={() => handlePageChange(num)} className={`pagination-button ${currentPage === num ? 'pagination-active' : ''}`}>{num}</button>
          ) : (
            <span key={`ellipsis-${index}`} className="px-3 py-1">{num}</span>
          )
        ))}
        <button onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages} className="pagination-button"><ChevronRight className="h-4 w-4" /></button>
        <button onClick={() => handlePageChange(totalPages)} disabled={currentPage === totalPages} className="pagination-button"><ChevronsRight className="h-4 w-4" /></button>
      </div>
    );
  };

  if (error) return <div className="text-red-500 text-center p-8">Failed to load rankings: {(error as Error).message}</div>;

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="relative pb-3 border-b-4 border-yellow-500 mb-6 mx-2 flex flex-col items-center justify-center min-h-[48px]">
        <h2 className="text-2xl sm:text-3xl font-serif font-bold text-yellow-400 tracking-widest uppercase drop-shadow-md text-center m-0">
          Official World Golf Rankings
        </h2>
        <p className="mt-1 text-sm text-yellow-200/80 uppercase tracking-wider font-bold">{year} Season</p>
      </div>
      <div className="flex items-center justify-between mb-4 px-2">
        <select
          value={year}
          onChange={e => setYear(Number(e.target.value))}
          className="pl-3 pr-8 py-2 border rounded-full bg-gray-50 focus:bg-white focus:ring-2 focus:ring-green-700 shadow-sm text-gray-900 font-semibold"
        >
          {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search player..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="pl-10 pr-4 py-2 border rounded-full bg-gray-50 focus:bg-white focus:ring-2 focus:ring-green-700 w-64 shadow-sm text-gray-900"
          />
        </div>
      </div>
      {loading ? (
        <div className="text-center"><div className="spinner"></div><p className="mt-2">Loading Rankings...</p></div>
      ) : allRankings.length === 0 ? (
        <div className="text-center p-8 bg-gray-50 rounded-lg shadow-inner">
          <h2 className="text-2xl font-semibold text-gray-700">No Data Available</h2>
          <p className="text-gray-500 mt-2">No rankings found for the selected year.</p>
        </div>
      ) : (
        <div className="card w-full shadow-inner overflow-hidden border border-gray-300 relative p-0 overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-100 text-gray-700 uppercase text-xs font-semibold border-b border-gray-300">
              <tr>
                <th onClick={() => requestSort('rank')} className="px-4 py-4 cursor-pointer text-center w-24">Rank {getSortIcon('rank')}</th>
                <th onClick={() => requestSort('fullName')} className="px-4 py-4 cursor-pointer text-left">Player {getSortIcon('fullName')}</th>
                <th onClick={() => requestSort('totalPoints')} className="px-4 py-4 cursor-pointer text-center w-32">Points {getSortIcon('totalPoints')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {currentRankings.map(player => (
                <tr key={player.id} className="hover:bg-gray-50 transition-colors duration-200">
                  <td className="px-4 py-3 font-semibold text-gray-900 border-r border-gray-100 text-center">{player.rank}</td>
                  <td className="px-4 py-3 font-bold text-green-800 hover:text-green-600 border-r border-gray-100">{player.fullName}</td>
                  <td className="px-4 py-3 text-center font-bold text-gray-900 bg-gray-50/50">{player.totalPoints?.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {totalPages > 1 && renderPagination()}
        </div>
      )}
    </div>
  );
};

export default RankingsPage;

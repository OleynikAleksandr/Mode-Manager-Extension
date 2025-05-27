import React, { useState, useEffect, useCallback } from 'react';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    horizontalListSortingStrategy, // Используем горизонтальную стратегию для плашек
} from '@dnd-kit/sortable';
import { SortableModeChip } from './components/SortableModeChip'; // Импортируем наш новый компонент

// --- Типы ---
interface Mode {
    id: string;
    slug: string;
    fullText: string;
    nameWithIcon: string;
    description: string;
    icon?: string;
    name: string;
}

// New types for Stacks By Framework
interface StackMode {
    id: string;
    slug: string;
    nameWithIcon: string;
    description: string;
    icon?: string;
    name: string;
}

interface StackSubgroup {
    id: string;
    title: string;
    fullTitle: string; // Include the number prefix
    description: string;
    modes: StackMode[];
    selected: boolean;
    partiallySelected: boolean;
}

interface StackFramework {
    id: string;
    title: string;
    description: string;
    subgroups: StackSubgroup[];
}

interface StacksData {
    generalPurpose: StackFramework;
    frameworks: StackFramework[];
}

interface VSCodeApi {
    postMessage(message: any): void;
    getState(): any;
    setState(newState: any): void;
}

// @ts-ignore
const vscode: VSCodeApi = acquireVsCodeApi();

// --- Вспомогательные функции ---
function parseModes(listContent: string): Mode[] {
    if (!listContent || typeof listContent !== 'string') {
        console.warn('parseModes: listContent is null, undefined, or not a string. Returning empty array.');
        return [];
    }
    const modes: Mode[] = [];
    const lines = listContent.split('\n');
    /*
     * Расширяем регулярное выражение, чтобы корректно обрабатывать разные типы дефиса
     * (обычный '-', en-dash '–', em-dash '—'). Эта гибкость необходима, поскольку
     * локализованные файлы списков режимов могут использовать различные символы.
     */
    const modeRegex = /^\s*(\d+)\.\s*(?:([\u2000-\u3300\uE000-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF\s]+?)\s+)?(.+?)\s+\(([^)]+)\)\s*[-–—]\s*(.+)/;

    lines.forEach((line, index) => {
        line = line.trim();
        if (!line) return;

        const match = line.match(modeRegex);
        const id = `mode-line-${index}`;
        if (match) {
            const icon = match[2] ? match[2].trim() : undefined;
            const name = match[3].trim();
            const slug = match[4].trim();
            const description = match[5].trim();
            const nameWithIcon = icon ? `${icon} ${name}` : name;
            modes.push({ id, slug, fullText: line, nameWithIcon, description, icon, name });
        } else {
            console.warn(`Line did not match regex for slug extraction: "${line}". Creating a basic entry without slug.`);
            const fallbackSlug = `unknown-slug-${index}`;
            // Упрощённый регекс также должен учитывать различные символы дефиса
            const simpleModeRegex = /^\s*(\d+)\.\s*(?:([\u2000-\u3300\uE000-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF\s]+?)\s+)?(.+?)\s*[-–—]\s*(.+)/;
            const simpleMatch = line.match(simpleModeRegex);
            if (simpleMatch) {
                const icon = simpleMatch[2] ? simpleMatch[2].trim() : undefined;
                const name = simpleMatch[3].trim();
                const description = simpleMatch[4].trim();
                const nameWithIcon = icon ? `${icon} ${name}` : name;
                modes.push({ id, slug: fallbackSlug, fullText: line, nameWithIcon, description, icon, name });
            } else {
                modes.push({ id, slug: fallbackSlug, fullText: line, nameWithIcon: line, description: '', name: line });
            }
        }
    });
    return modes;
}

// Parser for stacks data
function parseStacksData(stacksContent: string): StacksData {
    if (!stacksContent || typeof stacksContent !== 'string') {
        console.warn('parseStacksData: stacksContent is null, undefined, or not a string. Returning empty data.');
        return {
            generalPurpose: { id: 'general', title: '', description: '', subgroups: [] },
            frameworks: []
        };
    }

    const lines = stacksContent.split('\n');
    const frameworks: StackFramework[] = [];
    let currentFramework: StackFramework | null = null;
    let currentSubgroup: StackSubgroup | null = null;
    let generalPurpose: StackFramework = { id: 'general-purpose', title: '', description: '', subgroups: [] };
    let isGeneralPurpose = false;

    lines.forEach((line, index) => {
        const trimmedLine = line.trim();
        if (!trimmedLine) return;

        // Main framework headers (# 1. General-purpose modes, # 2. Framework stacks)
        if (trimmedLine.match(/^# \d+\.\s*(.+)/)) {
            const match = trimmedLine.match(/^# \d+\.\s*(.+)/);
            if (match) {
                const title = match[1];
                if (title.toLowerCase().includes('general') || title.toLowerCase().includes('загального') || title.toLowerCase().includes('універсальних')) {
                    isGeneralPurpose = true;
                    generalPurpose.title = title;
                    currentFramework = generalPurpose;
                } else {
                    isGeneralPurpose = false;
                    currentFramework = {
                        id: `framework-${frameworks.length}`,
                        title: title,
                        description: '',
                        subgroups: []
                    };
                    frameworks.push(currentFramework);
                }
            }
        }
        // Subgroup headers (## 1.1, ## 2.1, etc.)
        else if (trimmedLine.match(/^## (\d+\.\d+\s+.+)/)) {
            const match = trimmedLine.match(/^## (\d+\.\d+\s+.+)/);
            if (match && currentFramework) {
                const fullTitle = match[1]; // Include number like "2.1 React & Next.js"
                const titleParts = fullTitle.match(/^\d+\.\d+\s+(.+)$/);
                const title = titleParts ? titleParts[1] : fullTitle;

                currentSubgroup = {
                    id: `subgroup-${currentFramework.subgroups.length}`,
                    title: title,
                    fullTitle: fullTitle,
                    description: '',
                    modes: [],
                    selected: false,
                    partiallySelected: false
                };
                currentFramework.subgroups.push(currentSubgroup);
            }
        }
        // Description lines (after headers)
        else if (currentSubgroup && trimmedLine && !trimmedLine.startsWith('-') && !trimmedLine.startsWith('##')) {
            if (!currentSubgroup.description) {
                currentSubgroup.description = trimmedLine;
            }
        }
        // Mode lines (start with -)
        else if (trimmedLine.startsWith('-') && currentSubgroup && currentFramework) {
            const modeRegex = /^-\s*(?:([\u2000-\u3300\uE000-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF\s]+?)\s+)?(.+?)\s+\(([^)]+)\)/;
            const match = trimmedLine.match(modeRegex);

            if (match) {
                const icon = match[1] ? match[1].trim() : undefined;
                const name = match[2].trim();
                const slug = match[3].trim();
                const nameWithIcon = icon ? `${icon} ${name}` : name;

                const mode: StackMode = {
                    id: `mode-${currentFramework.id}-${currentSubgroup.id}-${currentSubgroup.modes.length}`,
                    slug: slug,
                    nameWithIcon: nameWithIcon,
                    description: '',
                    icon: icon,
                    name: name
                };
                currentSubgroup.modes.push(mode);
            }
        }
    });

    return {
        generalPurpose: generalPurpose,
        frameworks: frameworks
    };
}


function App() {
    const [modesData, setModesData] = useState<Mode[]>([]);
    const [currentSelectedModeIds, setCurrentSelectedModeIds] = useState<Set<string>>(new Set());
    const [orderedSelectedModeObjects, setOrderedSelectedModeObjects] = useState<Mode[]>([]); // For UI rendering of chips and list
    const [selectedAndOrderedSlugs, setSelectedAndOrderedSlugs] = useState<string[]>([]); // Source of truth for selection & order
    const [currentLanguage, setCurrentLanguage] = useState<string>('en');
    const [initialSelectedSlugs, setInitialSelectedSlugs] = useState<string[]>([]); // For cancel functionality
    const [activeTab, setActiveTab] = useState<number>(0); // 0 - Custom Modes, 1 - Stacks By Framework
    // initialSelectedModeIds and initialOrderedSelectedModeObjects are no longer primary for cancel
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [firstLoad, setFirstLoad] = useState<boolean>(true);

    // New state for Stacks By Framework tab
    const [stacksData, setStacksData] = useState<StacksData>({
        generalPurpose: { id: 'general', title: '', description: '', subgroups: [] },
        frameworks: []
    });
    const [selectedStackModeIds, setSelectedStackModeIds] = useState<Set<string>>(new Set());
    const [isStacksLoading, setIsStacksLoading] = useState<boolean>(true);
    const [stacksError, setStacksError] = useState<string | null>(null);


    const MOCK_MODES_DATA_FALLBACK = `
# Roo Modes List (Fallback)

## Roo Modes

1. **👑 Roo Commander (roo-commander)** - Fallback description.
2. **💻 Code (code)** - Fallback description.
`;

    const updateButtonStates = useCallback(() => {
        // Логика сравнения initial и current состояний для активности кнопок
        // Для простоты пока всегда активны, если есть изменения
        // Compare selectedAndOrderedSlugs with initialSelectedSlugs for changes
        const changed = selectedAndOrderedSlugs.length !== initialSelectedSlugs.length ||
            !selectedAndOrderedSlugs.every((slug, index) => slug === initialSelectedSlugs[index]);
        return changed;
    }, [selectedAndOrderedSlugs, initialSelectedSlugs]);


    useEffect(() => {
        vscode.postMessage({ command: 'webviewReady' });
    }, []);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            console.log('React App: Received message:', message);
            switch (message.command) {
                case 'loadModes':
                    setIsLoading(false);
                    setError(null);
                    const parsed = parseModes(message.data);
                    console.log('React App: Parsed modes data:', parsed); // <-- Новый лог
                    setModesData(parsed);
                    const newLanguage = message.language || 'en';
                    setCurrentLanguage(newLanguage);
                    setModesData(parsed); // Update available modes

                    if (firstLoad) {
                        console.log('React App: First load, processing selectedModesOrdered from extension:', message.selectedModesOrdered);
                        const slugsFromExtension: string[] = (message.selectedModesOrdered || [])
                            .sort((a: { slug: string, order: number }, b: { slug: string, order: number }) => a.order - b.order)
                            .map((item: { slug: string, order: number }) => item.slug);

                        setSelectedAndOrderedSlugs(slugsFromExtension);
                        setInitialSelectedSlugs([...slugsFromExtension]); // For cancel
                        setFirstLoad(false);
                        console.log('React App: First load processed. Selected slugs set to:', slugsFromExtension);
                    }
                    // For language changes, selectedAndOrderedSlugs remains the source of truth.
                    // The useEffect below will re-calculate orderedSelectedModeObjects and currentSelectedModeIds.
                    break;
                case 'loadModesError':
                    setIsLoading(false);
                    setError(message.message || 'Unknown error loading modes.');
                    setModesData(parseModes(MOCK_MODES_DATA_FALLBACK)); // Load fallback
                    break;
                case 'loadStacks':
                    setIsStacksLoading(false);
                    setStacksError(null);
                    const parsedStacks = parseStacksData(message.data);
                    console.log('React App: Parsed stacks data:', parsedStacks);
                    setStacksData(parsedStacks);
                    break;
                case 'loadStacksError':
                    setIsStacksLoading(false);
                    setStacksError(message.message || 'Unknown error loading stacks.');
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        return () => {
            window.removeEventListener('message', handleMessage);
        };
    }, [firstLoad]); // Only depends on firstLoad now

    // NEW: Function to convert stack mode to unified Mode object
    const stackModeToMode = useCallback((stackMode: StackMode): Mode => {
        return {
            id: `unified-${stackMode.slug}`, // Use slug-based ID for consistency
            slug: stackMode.slug,
            fullText: stackMode.nameWithIcon,
            nameWithIcon: stackMode.nameWithIcon,
            description: stackMode.description || '',
            icon: stackMode.icon,
            name: stackMode.name
        };
    }, []);

    // NEW: Get all stack modes as unified Mode objects
    const getAllStackModes = useCallback((): Mode[] => {
        const allStackModes: Mode[] = [];

        // Add from general purpose
        stacksData.generalPurpose.subgroups.forEach(subgroup => {
            subgroup.modes.forEach(mode => {
                allStackModes.push(stackModeToMode(mode));
            });
        });

        // Add from frameworks
        stacksData.frameworks.forEach(framework => {
            framework.subgroups.forEach(subgroup => {
                subgroup.modes.forEach(mode => {
                    allStackModes.push(stackModeToMode(mode));
                });
            });
        });

        return allStackModes;
    }, [stacksData, stackModeToMode]);

    // UNIFIED: Single handler for both tabs - uses slug-based selection
    const handleUnifiedModeSelection = useCallback((slug: string, isSelected: boolean) => {
        console.log('handleUnifiedModeSelection:', slug, isSelected);
        setSelectedAndOrderedSlugs(prevSlugs => {
            if (isSelected) {
                if (!prevSlugs.includes(slug)) {
                    return [...prevSlugs, slug];
                }
                return prevSlugs;
            } else {
                return prevSlugs.filter(s => s !== slug);
            }
        });
    }, []);

    // UNIFIED: Batch handler for multiple slugs (for subgroups)
    const handleUnifiedBatchModeSelection = useCallback((slugs: string[], isSelected: boolean) => {
        console.log('handleUnifiedBatchModeSelection:', slugs, isSelected);
        setSelectedAndOrderedSlugs(prevSlugs => {
            if (isSelected) {
                // Add all slugs that are not already in the array
                const newSlugs = slugs.filter(slug => !prevSlugs.includes(slug));
                return [...prevSlugs, ...newSlugs];
            } else {
                // Remove all specified slugs
                return prevSlugs.filter(slug => !slugs.includes(slug));
            }
        });
    }, []);

    // This useEffect updates the UI-specific state (Mode objects and Set of Ids)
    // whenever the source of truth (selectedAndOrderedSlugs) or available modes (modesData/stacksData) changes.
    useEffect(() => {
        console.log('React App: Rebuilding unified selection state. Slugs:', selectedAndOrderedSlugs);

        const newOrderedObjects: Mode[] = [];
        const newSelectedIds = new Set<string>();
        const newSelectedStackModeIds = new Set<string>();

        // Get all available modes from both sources
        const allCustomModes = modesData;
        const allStackModes = getAllStackModes();

        // Update selectedIds for Custom Modes - check by slug
        allCustomModes.forEach(mode => {
            if (selectedAndOrderedSlugs.includes(mode.slug)) {
                newSelectedIds.add(mode.id);
            }
        });

        // Update selectedStackModeIds for Stack Modes - check by slug
        const updateStackModeIds = (subgroups: StackSubgroup[]) => {
            subgroups.forEach(subgroup => {
                subgroup.modes.forEach(mode => {
                    if (selectedAndOrderedSlugs.includes(mode.slug)) {
                        newSelectedStackModeIds.add(mode.id);
                    }
                });
            });
        };
        updateStackModeIds(stacksData.generalPurpose.subgroups);
        stacksData.frameworks.forEach(fw => updateStackModeIds(fw.subgroups));

        // Build ordered objects for chips (prioritize custom modes, then stack modes)
        selectedAndOrderedSlugs.forEach(slug => {
            // Try to find in custom modes first
            let mode = allCustomModes.find(m => m.slug === slug);
            if (mode) {
                newOrderedObjects.push(mode);
            } else {
                // Try to find in stack modes
                mode = allStackModes.find(m => m.slug === slug);
                if (mode) {
                    newOrderedObjects.push(mode);
                } else {
                    console.warn(`React App: Slug "${slug}" not found in either modesData or stacksData during UI rebuild.`);
                }
            }
        });

        console.log('React App: Before setState - Custom IDs:', newSelectedIds, 'Stack IDs:', newSelectedStackModeIds);
        setOrderedSelectedModeObjects(newOrderedObjects);
        setCurrentSelectedModeIds(newSelectedIds);
        setSelectedStackModeIds(newSelectedStackModeIds);
        console.log('React App: Unified selection state updated. Objects:', newOrderedObjects.length, 'Custom IDs:', newSelectedIds.size, 'Stack IDs:', newSelectedStackModeIds.size);
    }, [selectedAndOrderedSlugs, modesData, stacksData, getAllStackModes]);

    const handleSelectionChange = (modeId: string, isSelected: boolean) => {
        const modeObject = modesData.find(m => m.id === modeId);
        if (!modeObject) return;

        handleUnifiedModeSelection(modeObject.slug, isSelected);
    };

    const handleApply = () => {
        const selectedModesWithOrder = selectedAndOrderedSlugs.map((slug, index) => ({
            slug: slug,
            order: index
        }));
        vscode.postMessage({
            command: 'applyModeChanges',
            selectedModes: selectedModesWithOrder
        });
        setInitialSelectedSlugs([...selectedAndOrderedSlugs]); // Update initial state for cancel
    };

    const handleCancel = () => {
        setSelectedAndOrderedSlugs([...initialSelectedSlugs]); // Revert to initial slugs
        vscode.postMessage({ command: 'cancelModeChanges' });
    };

    const handleLanguageChange = (lang: 'en' | 'ru' | 'ua') => {
        if (currentLanguage !== lang) {
            // Only send language, selectedAndOrderedSlugs will be preserved locally
            vscode.postMessage({ command: 'requestModeList', lang: lang });
            // Also request stacks data for the new language
            vscode.postMessage({ command: 'requestStacksList', lang: lang });
        }
    };

    // Handlers for stacks selection (now redirects to unified handler)
    const handleStackModeSelection = (modeId: string, isSelected: boolean) => {
        // Find the stack mode by ID and get its slug
        let targetSlug: string | null = null;

        // Search in general purpose
        for (const subgroup of stacksData.generalPurpose.subgroups) {
            const found = subgroup.modes.find(mode => mode.id === modeId);
            if (found) {
                targetSlug = found.slug;
                break;
            }
        }

        // Search in frameworks if not found
        if (!targetSlug) {
            for (const framework of stacksData.frameworks) {
                for (const subgroup of framework.subgroups) {
                    const found = subgroup.modes.find(mode => mode.id === modeId);
                    if (found) {
                        targetSlug = found.slug;
                        break;
                    }
                }
                if (targetSlug) break;
            }
        }

        if (targetSlug) {
            handleUnifiedModeSelection(targetSlug, isSelected);
        }
    };

    const handleSubgroupSelection = (subgroupId: string, isSelected: boolean) => {
        console.log('=== handleSubgroupSelection START ===');
        console.log('subgroupId:', subgroupId, 'isSelected:', isSelected);

        // Find the subgroup and toggle all its modes using unified system
        let targetSubgroup: StackSubgroup | null = null;

        // Search in frameworks first (most likely location)
        for (const framework of stacksData.frameworks) {
            const found = framework.subgroups.find(sg => sg.id === subgroupId);
            if (found) {
                targetSubgroup = found;
                console.log('Found targetSubgroup in framework:', framework.title);
                break;
            }
        }

        // Search in general purpose if not found
        if (!targetSubgroup && stacksData.generalPurpose.subgroups) {
            targetSubgroup = stacksData.generalPurpose.subgroups.find(sg => sg.id === subgroupId) || null;
            if (targetSubgroup) {
                console.log('Found targetSubgroup in general purpose');
            }
        }

        if (!targetSubgroup) {
            console.error('ERROR: No targetSubgroup found for subgroupId:', subgroupId);
            console.log('Available subgroups:');
            stacksData.frameworks.forEach(fw => {
                console.log(`Framework: ${fw.title}`);
                fw.subgroups.forEach(sg => console.log(`  - ${sg.id} (${sg.fullTitle})`));
            });
            return;
        }

        console.log('Target subgroup:', targetSubgroup.fullTitle);
        console.log('Modes in subgroup:', targetSubgroup.modes.length);

        // Use unified batch system - toggle all modes by slug in one operation
        const slugsToToggle = targetSubgroup.modes.map(mode => mode.slug);
        console.log(`Batch ${isSelected ? 'SELECTING' : 'DESELECTING'} slugs:`, slugsToToggle);
        handleUnifiedBatchModeSelection(slugsToToggle, isSelected);

        console.log('=== handleSubgroupSelection END ===');
    };

    const updateSubgroupSelection = useCallback(() => {
        console.log('updateSubgroupSelection called, selectedStackModeIds:', selectedStackModeIds);
        setStacksData(prev => {
            const updated = JSON.parse(JSON.stringify(prev)); // Deep clone

            const updateSubgroupsInFramework = (framework: StackFramework) => {
                framework.subgroups.forEach(subgroup => {
                    const selectedCount = subgroup.modes.filter(mode =>
                        selectedStackModeIds.has(mode.id)
                    ).length;

                    const oldSelected = subgroup.selected;
                    const oldPartiallySelected = subgroup.partiallySelected;

                    subgroup.selected = selectedCount === subgroup.modes.length && subgroup.modes.length > 0;
                    subgroup.partiallySelected = selectedCount > 0 && selectedCount < subgroup.modes.length;

                    console.log(`Subgroup ${subgroup.id}: selectedCount=${selectedCount}, totalCount=${subgroup.modes.length}, selected=${subgroup.selected}, partiallySelected=${subgroup.partiallySelected}`);
                });
            };

            updateSubgroupsInFramework(updated.generalPurpose);
            updated.frameworks.forEach(updateSubgroupsInFramework);

            return updated;
        });
    }, [selectedStackModeIds]);

    // Load stacks data on tab switch
    useEffect(() => {
        if (activeTab === 1 && isStacksLoading) {
            vscode.postMessage({ command: 'requestStacksList', lang: currentLanguage });
        }
    }, [activeTab, currentLanguage, isStacksLoading]);

    // Update subgroup states when selectedStackModeIds changes
    useEffect(() => {
        updateSubgroupSelection();
    }, [selectedStackModeIds]);

    // Update subgroup states when stacksData changes (e.g., language switch)
    useEffect(() => {
        if (stacksData.frameworks.length > 0 || stacksData.generalPurpose.subgroups.length > 0) {
            console.log('stacksData changed, updating subgroup selection states');
            updateSubgroupSelection();
        }
    }, [stacksData, updateSubgroupSelection]);

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const handleDragEnd = useCallback((event: DragEndEvent) => {
        const { active, over } = event;

        if (over && active.id !== over.id) {
            // Update selectedAndOrderedSlugs based on drag-and-drop of Mode objects
            setOrderedSelectedModeObjects((currentOrderedObjects) => {
                const activeMode = currentOrderedObjects.find(item => item.id === active.id);
                const overMode = currentOrderedObjects.find(item => item.id === over.id);

                if (activeMode && overMode) {
                    const oldIndex = currentOrderedObjects.findIndex((item) => item.id === active.id);
                    const newIndex = currentOrderedObjects.findIndex((item) => item.id === over.id);
                    const newOrderedModeObjects = arrayMove(currentOrderedObjects, oldIndex, newIndex);

                    // Update the source of truth for slugs
                    setSelectedAndOrderedSlugs(newOrderedModeObjects.map(m => m.slug));
                    return newOrderedModeObjects; // This updates the draggable chips directly
                }
                return currentOrderedObjects;
            });
        }
    }, []);

    const canApplyOrCancel = updateButtonStates();

    if (isLoading) {
        return <div>Loading modes...</div>;
    }

    if (error) {
        return <div style={{ color: 'red' }}>Error: {error}</div>;
    }

    return (
        <div className="container">
            <div className="tab-bar">
                <div
                    className={`tab${activeTab === 0 ? " active" : ""}`}
                    onClick={() => setActiveTab(0)}
                >
                    Roo Code Custom Modes
                </div>
                <div
                    className={`tab${activeTab === 1 ? " active" : ""}`}
                    onClick={() => setActiveTab(1)}
                >
                    Stacks By Framework
                </div>
            </div>
            {activeTab === 0 && (
                <>
                    <header>
                        <div className="selection-summary">
                            <p>Selected: <span id="selected-count">{orderedSelectedModeObjects.length}</span> Modes:</p>
                            <DndContext
                                sensors={sensors}
                                collisionDetection={closestCenter}
                                onDragEnd={handleDragEnd}
                            >
                                <SortableContext
                                    items={orderedSelectedModeObjects.map(mode => mode.id)}
                                    strategy={horizontalListSortingStrategy}
                                >
                                    <div id="selected-names-chips" style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '2px' }}>
                                        {orderedSelectedModeObjects.map(mode => (
                                            <SortableModeChip key={mode.id} mode={mode} />
                                        ))}
                                    </div>
                                </SortableContext>
                            </DndContext>
                        </div>
                    </header>
                    <main>
                        <div id="modes-list" className="modes-list">
                            {modesData.map(mode => {
                                const isSelected = selectedAndOrderedSlugs.includes(mode.slug);
                                return (
                                    <div
                                        key={mode.id}
                                        className={`mode-item ${isSelected ? 'selected' : ''}`}
                                        onClick={() => handleSelectionChange(mode.id, !isSelected)}
                                    >
                                        <input
                                            type="checkbox"
                                            id={`chk-${mode.id}`}
                                            checked={isSelected}
                                            onChange={(e) => handleSelectionChange(mode.id, e.target.checked)}
                                            onClick={(e) => e.stopPropagation()}
                                            aria-label={`Select mode ${mode.nameWithIcon}`}
                                        />
                                        <div className="mode-content">
                                            <span className="mode-name-display">{mode.nameWithIcon}</span>
                                            <span className="mode-description-display"> - {mode.description}</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </main>
                </>
            )}
            {activeTab === 1 && (
                <>
                    <header>
                        <div className="selection-summary">
                            <p>Selected: <span id="selected-count">{orderedSelectedModeObjects.length}</span> Modes:</p>
                            <DndContext
                                sensors={sensors}
                                collisionDetection={closestCenter}
                                onDragEnd={handleDragEnd}
                            >
                                <SortableContext
                                    items={orderedSelectedModeObjects.map(mode => mode.id)}
                                    strategy={horizontalListSortingStrategy}
                                >
                                    <div id="selected-names-chips" style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '2px' }}>
                                        {orderedSelectedModeObjects.map(mode => (
                                            <SortableModeChip key={mode.id} mode={mode} />
                                        ))}
                                    </div>
                                </SortableContext>
                            </DndContext>
                        </div>
                    </header>
                    <main>
                        {isStacksLoading ? (
                            <div>Loading stacks...</div>
                        ) : stacksError ? (
                            <div style={{ color: 'red' }}>Error: {stacksError}</div>
                        ) : (
                            <div className="stacks-container">
                                {/* General Purpose Section */}
                                {stacksData.generalPurpose.subgroups.length > 0 && (
                                    <div className="framework-section">
                                        <h2>{stacksData.generalPurpose.title}</h2>
                                        {stacksData.generalPurpose.subgroups.map(subgroup => (
                                            <div key={subgroup.id} className="subgroup-section">
                                                <div className="subgroup-header">
                                                    <h3>{subgroup.fullTitle}</h3>
                                                </div>
                                                {subgroup.description && (
                                                    <p className="subgroup-description">{subgroup.description}</p>
                                                )}
                                                <div className="modes-list">
                                                    {subgroup.modes.map(mode => {
                                                        const isSelected = selectedAndOrderedSlugs.includes(mode.slug);
                                                        return (
                                                            <div
                                                                key={mode.id}
                                                                className={`mode-item ${isSelected ? 'selected' : ''}`}
                                                                onClick={() => handleStackModeSelection(mode.id, !isSelected)}
                                                            >
                                                                <input
                                                                    type="checkbox"
                                                                    id={`stack-mode-${mode.id}`}
                                                                    checked={isSelected}
                                                                    onChange={(e) => handleStackModeSelection(mode.id, e.target.checked)}
                                                                    onClick={(e) => e.stopPropagation()}
                                                                    aria-label={`Select mode ${mode.nameWithIcon}`}
                                                                />
                                                                <div className="mode-content">
                                                                    <span className="mode-name-display">{mode.nameWithIcon}</span>
                                                                    {mode.description && (
                                                                        <span className="mode-description-display"> - {mode.description}</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Framework Sections */}
                                {stacksData.frameworks.map(framework => (
                                    <div key={framework.id} className="framework-section">
                                        <h2>{framework.title}</h2>
                                        {framework.description && (
                                            <p className="framework-description">{framework.description}</p>
                                        )}
                                        {framework.subgroups.map(subgroup => (
                                            <div key={subgroup.id} className="subgroup-section">
                                                <div className="subgroup-header">
                                                    <input
                                                        type="checkbox"
                                                        id={`subgroup-${subgroup.id}`}
                                                        checked={subgroup.selected}
                                                        ref={input => {
                                                            if (input) {
                                                                input.indeterminate = subgroup.partiallySelected && !subgroup.selected;
                                                            }
                                                        }}
                                                        onChange={(e) => {
                                                            console.log('Subgroup checkbox clicked:', subgroup.id, 'checked:', e.target.checked);
                                                            handleSubgroupSelection(subgroup.id, e.target.checked);
                                                        }}
                                                        onClick={(e) => {
                                                            console.log('Subgroup checkbox onClick:', subgroup.id);
                                                            e.stopPropagation();
                                                        }}
                                                        aria-label={`Select subgroup ${subgroup.title}`}
                                                    />
                                                    <h3>{subgroup.fullTitle}</h3>
                                                </div>
                                                {subgroup.description && (
                                                    <p className="subgroup-description">{subgroup.description}</p>
                                                )}
                                                <div className="modes-list">
                                                    {subgroup.modes.map(mode => {
                                                        const isSelected = selectedAndOrderedSlugs.includes(mode.slug);
                                                        return (
                                                            <div
                                                                key={mode.id}
                                                                className={`mode-item ${isSelected ? 'selected' : ''}`}
                                                                onClick={() => handleStackModeSelection(mode.id, !isSelected)}
                                                            >
                                                                <input
                                                                    type="checkbox"
                                                                    id={`stack-mode-${mode.id}`}
                                                                    checked={isSelected}
                                                                    onChange={(e) => handleStackModeSelection(mode.id, e.target.checked)}
                                                                    onClick={(e) => e.stopPropagation()}
                                                                    aria-label={`Select mode ${mode.nameWithIcon}`}
                                                                />
                                                                <div className="mode-content">
                                                                    <span className="mode-name-display">{mode.nameWithIcon}</span>
                                                                    {mode.description && (
                                                                        <span className="mode-description-display"> - {mode.description}</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ))}
                            </div>
                        )}
                    </main>
                </>
            )}
            <footer>
                <div className="footer-inner">
                    <div className="language-switcher">
                        <label htmlFor="lang-toggle">Language:</label>
                        <button onClick={() => handleLanguageChange('en')} className={currentLanguage === 'en' ? 'active lang-button' : 'lang-button'}>EN</button>
                        <button onClick={() => handleLanguageChange('ua')} className={currentLanguage === 'ua' ? 'active lang-button' : 'lang-button'}>UA</button>
                    </div>
                    <div className="action-buttons">
                        <button id="apply-button" onClick={handleApply} disabled={!canApplyOrCancel}>Apply</button>
                        <button id="cancel-button" onClick={handleCancel}>Cancel</button>
                    </div>
                </div>
            </footer>
        </div>
    );
}

export default App;
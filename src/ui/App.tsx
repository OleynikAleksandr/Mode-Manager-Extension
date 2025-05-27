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
    const [orderedSelectedModeObjects, setOrderedSelectedModeObjects] = useState<StackMode[]>([]); // For UI rendering of chips and list
    const [selectedAndOrderedSlugs, setSelectedAndOrderedSlugs] = useState<string[]>([]); // Source of truth for selection & order
    const [currentLanguage, setCurrentLanguage] = useState<string>('en');
    const [initialSelectedSlugs, setInitialSelectedSlugs] = useState<string[]>([]); // For cancel functionality
    const [activeTab, setActiveTab] = useState<number>(0); // 0 - Stacks By Framework, 1 - New Tab (Empty)
    const [firstLoad, setFirstLoad] = useState<boolean>(true);

    // New state for Stacks By Framework tab
    const [stacksData, setStacksData] = useState<StacksData>({
        generalPurpose: { id: 'general', title: '', description: '', subgroups: [] },
        frameworks: []
    });
    const [selectedStackModeIds, setSelectedStackModeIds] = useState<Set<string>>(new Set());
    const [isStacksLoading, setIsStacksLoading] = useState<boolean>(true);
    const [stacksError, setStacksError] = useState<string | null>(null);

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
        // Request stacks data on initial load
        vscode.postMessage({ command: 'requestStacksList', lang: currentLanguage });
    }, [currentLanguage]); // Added currentLanguage dependency

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            console.log('React App: Received message:', message);
            switch (message.command) {
                case 'loadStacks':
                    setIsStacksLoading(false);
                    setStacksError(null);
                    const parsedStacks = parseStacksData(message.data);
                    console.log('React App: Parsed stacks data:', parsedStacks);
                    setStacksData(parsedStacks);

                    if (firstLoad) {
                        console.log('React App: First load, processing selectedModesOrdered from extension:', message.selectedModesOrdered);
                        const slugsFromExtension: string[] = (message.selectedModesOrdered || [])
                            .sort((a: { slug: string, order: number }, b: { slug: string, order: number }) => a.order - b.order)
                            .map((item: { slug: string, order: number }) => item.slug);

                        setSelectedAndOrderedSlugs(slugsFromExtension);
                        setInitialSelectedSlugs([...slugsFromExtension]); // For cancel
                        setFirstLoad(false); // Ensure this is set to false after processing
                        console.log('React App: First load processed. Selected slugs set to:', slugsFromExtension);
                    }
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

    // NEW: Function to convert stack mode to unified StackMode object (already StackMode, but ensures consistency if needed)
    const stackModeToMode = useCallback((stackMode: StackMode): StackMode => {
        // In this refactored version, StackMode is the primary type.
        // This function might seem redundant but is kept for structural similarity
        // and in case future transformations are needed.
        return {
            ...stackMode,
            id: `unified-${stackMode.slug}`, // Ensure consistent ID prefix if used across different sources in future
        };
    }, []);

    // NEW: Get all stack modes as unified StackMode objects
    const getAllStackModes = useCallback((): StackMode[] => {
        const allStackModes: StackMode[] = [];

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

    // UNIFIED: Single handler for selection - uses slug-based selection
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

        const newOrderedObjects: StackMode[] = [];
        const newSelectedStackModeIds = new Set<string>();

        // Get all available modes from stacksData
        const allStackModes = getAllStackModes();

        // Update selectedStackModeIds for Stack Modes - check by slug
        const updateStackModeIds = (subgroups: StackSubgroup[]) => {
            subgroups.forEach(subgroup => {
                subgroup.modes.forEach(mode => {
                    // Ensure mode.id is used for the Set, as it's the key for UI selection state
                    if (selectedAndOrderedSlugs.includes(mode.slug)) {
                        newSelectedStackModeIds.add(mode.id);
                    }
                });
            });
        };
        updateStackModeIds(stacksData.generalPurpose.subgroups);
        stacksData.frameworks.forEach(fw => updateStackModeIds(fw.subgroups));

        // Build ordered objects for chips from stack modes
        selectedAndOrderedSlugs.forEach(slug => {
            const mode = allStackModes.find(m => m.slug === slug);
            if (mode) {
                // Push the original StackMode object, not the potentially ID-altered one from stackModeToMode,
                // unless stackModeToMode is essential for other properties.
                // For consistency, let's find the original mode from stacksData directly or ensure getAllStackModes returns original IDs.
                // The current getAllStackModes returns `unified-${slug}` as ID. Let's adjust.
                const originalMode = findOriginalStackModeBySlug(slug, stacksData);
                if (originalMode) {
                    newOrderedObjects.push(originalMode);
                } else {
                     console.warn(`React App: Slug "${slug}" not found in stacksData during UI rebuild for ordered objects.`);
                }
            } else {
                console.warn(`React App: Slug "${slug}" not found in allStackModes during UI rebuild.`);
            }
        });
        
        // Helper to find original StackMode to preserve original IDs for chips
        const findOriginalStackModeBySlug = (slug: string, data: StacksData): StackMode | undefined => {
            for (const sg of data.generalPurpose.subgroups) {
                const found = sg.modes.find(m => m.slug === slug);
                if (found) return found;
            }
            for (const fw of data.frameworks) {
                for (const sg of fw.subgroups) {
                    const found = sg.modes.find(m => m.slug === slug);
                    if (found) return found;
                }
            }
            return undefined;
        };


        console.log('React App: Before setState - Stack IDs:', newSelectedStackModeIds);
        setOrderedSelectedModeObjects(newOrderedObjects);
        setSelectedStackModeIds(newSelectedStackModeIds); // This is critical for subgroup checkbox state
        console.log('React App: Unified selection state updated. Objects:', newOrderedObjects.length, 'Stack IDs:', newSelectedStackModeIds.size);
    }, [selectedAndOrderedSlugs, stacksData, getAllStackModes]); // Added stacksData dependency

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
            setCurrentLanguage(lang); // Update language state
            // Request stacks data for the new language
            // selectedAndOrderedSlugs will be preserved locally
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
            // Manual deep clone to ensure modes arrays are preserved
            const manuallyClonedGeneralPurposeSubgroups = prev.generalPurpose.subgroups.map(sg => ({
                ...sg,
                modes: sg.modes.map(m => ({ ...m })), // Clone each mode
                selected: false, // Will be recalculated
                partiallySelected: false, // Will be recalculated
            }));

            const manuallyClonedFrameworks = prev.frameworks.map(fw => ({
                ...fw,
                subgroups: fw.subgroups.map(sg => ({
                    ...sg,
                    modes: sg.modes.map(m => ({ ...m })), // Clone each mode
                    selected: false, // Will be recalculated
                    partiallySelected: false, // Will be recalculated
                })),
            }));
            
            const updatedStacksData: StacksData = {
                generalPurpose: {
                    ...prev.generalPurpose,
                    subgroups: manuallyClonedGeneralPurposeSubgroups,
                },
                frameworks: manuallyClonedFrameworks,
            };

            const updateSelectionStatesInFramework = (framework: StackFramework) => {
                framework.subgroups.forEach(subgroup => {
                    // Ensure subgroup.modes is an array before filtering
                    const modesArray = Array.isArray(subgroup.modes) ? subgroup.modes : [];
                    const selectedCount = modesArray.filter(mode =>
                        selectedStackModeIds.has(mode.id)
                    ).length;

                    subgroup.selected = selectedCount === modesArray.length && modesArray.length > 0;
                    subgroup.partiallySelected = selectedCount > 0 && selectedCount < modesArray.length;
                    
                    console.log(`Subgroup ${subgroup.id} (${subgroup.fullTitle}): selectedCount=${selectedCount}, totalCount=${modesArray.length}, selected=${subgroup.selected}, partiallySelected=${subgroup.partiallySelected}, Modes:`, JSON.stringify(modesArray.map(m => m.slug)));
                });
            };

            updateSelectionStatesInFramework(updatedStacksData.generalPurpose);
            updatedStacksData.frameworks.forEach(updateSelectionStatesInFramework);
            
            // --- Debugging Start ---
            console.log('DEBUG: updateSubgroupSelection - updated object:', JSON.stringify(updatedStacksData, null, 2));
            if (updatedStacksData.frameworks.some((fw: StackFramework) => !fw.subgroups || fw.subgroups.some((sg: StackSubgroup) => !sg.modes || !Array.isArray(sg.modes)))) {
                console.error('DEBUG: updateSubgroupSelection - Problem detected: modes/subgroups missing or not arrays before return');
            } else {
                console.log('DEBUG: updateSubgroupSelection - No problem detected with modes/subgroups arrays before return.');
            }
            // --- Debugging End ---

            return updatedStacksData;
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
            // updateSubgroupSelection is already called when selectedStackModeIds changes,
            // and selectedStackModeIds changes when selectedAndOrderedSlugs or stacksData changes.
            // Explicit call here might be redundant if dependencies are set up correctly.
            // However, ensuring it runs after stacksData is fully parsed and set is good.
            updateSubgroupSelection();
        }
    }, [stacksData, updateSubgroupSelection]); // updateSubgroupSelection is a dependency here

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const handleDragEnd = useCallback((event: DragEndEvent) => {
        const { active, over } = event;

        if (over && active.id !== over.id) {
            // Update selectedAndOrderedSlugs based on drag-and-drop of StackMode objects
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

    // Display loading state for stacks if needed, or a general loading.
    // if (isLoading) { // isLoading was removed
    //     return <div>Loading...</div>;
    // }
    // if (error) { // error was removed
    // return <div style={{ color: 'red' }}>Error: {error}</div>;
    // }


    return (
        <div className="container">
            <div className="tab-bar">
                <div
                    className={`tab${activeTab === 0 ? " active" : ""}`}
                    onClick={() => setActiveTab(0)}
                >
                    Stacks By Framework
                </div>
                <div
                    className={`tab${activeTab === 1 ? " active" : ""}`}
                    onClick={() => setActiveTab(1)}
                >
                    New Tab (Empty)
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
                                    items={orderedSelectedModeObjects.map(mode => mode.id)} // Ensure mode.id is correct here
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
                                                                    id={`stack-mode-${mode.id}`} // Ensure unique IDs if mode.id can repeat across subgroups
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
                                                            e.stopPropagation(); // Important to prevent subgroup click from toggling individual modes if header is also clickable
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
                                                                key={mode.id} // Ensure unique IDs
                                                                className={`mode-item ${isSelected ? 'selected' : ''}`}
                                                                onClick={() => handleStackModeSelection(mode.id, !isSelected)}
                                                            >
                                                                <input
                                                                    type="checkbox"
                                                                    id={`stack-mode-${mode.id}`} // Ensure unique IDs
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
            {activeTab === 1 && (
                <div>Content for the new tab will be here.</div>
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
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:design_system/design_system.dart';

import '../l10n/app_localizations.dart';
import '../models/asset.dart';
import '../models/group.dart';
import '../models/reward.dart';
import '../services/asset_upload_service.dart';
import '../services/graphql_client.dart';
import '../services/reward_repository.dart';
import '../utils/form_advanced_values.dart';

class RewardFormScreen extends StatefulWidget {
  const RewardFormScreen({
    super.key,
    required this.rewardRepository,
    required this.assetUploadService,
    this.definition,
  });

  final RewardRepository rewardRepository;
  final AssetUploadService assetUploadService;
  final RewardDefinition? definition;

  bool get isEditing => definition != null;

  @override
  State<RewardFormScreen> createState() => _RewardFormScreenState();
}

class _RewardFormScreenState extends State<RewardFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _advancedKey = GlobalKey<AdvancedFormSectionState>();
  late final TextEditingController _nameController;
  late final TextEditingController _descriptionController;
  late final TextEditingController _notesController;
  late final TextEditingController _categoryController;
  late final TextEditingController _tagsController;
  late final TextEditingController _iconController;

  late String _color;
  late bool _stackable;
  int? _imageAssetId;
  Uint8List? _previewBytes;
  bool _saving = false;
  bool _uploading = false;
  List<Asset> _recentAssets = const [];

  bool get _hasAdvancedValues => rewardHasAdvancedValues(
        notes: _notesController.text,
        category: _categoryController.text,
        tags: _tagsController.text,
        icon: _iconController.text,
        stackable: _stackable,
      );

  @override
  void initState() {
    super.initState();
    final d = widget.definition;
    _nameController = TextEditingController(text: d?.name ?? '');
    _descriptionController = TextEditingController(text: d?.description ?? '');
    _notesController = TextEditingController(text: d?.notes ?? '');
    _categoryController = TextEditingController(text: d?.category ?? '');
    _tagsController = TextEditingController(
      text: d?.tags.join(', ') ?? '',
    );
    _iconController = TextEditingController(text: d?.icon ?? '');
    _color = d?.color ?? kGroupColorPalette.first;
    _stackable = d?.stackable ?? true;
    _imageAssetId = d?.imageAssetId;
    _loadRecent();
    _loadPreview();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _descriptionController.dispose();
    _notesController.dispose();
    _categoryController.dispose();
    _tagsController.dispose();
    _iconController.dispose();
    super.dispose();
  }

  Future<void> _loadRecent() async {
    try {
      final assets = await widget.rewardRepository.fetchRecentAssets();
      if (mounted) setState(() => _recentAssets = assets);
    } catch (_) {}
  }

  Future<void> _loadPreview() async {
    final id = _imageAssetId;
    if (id == null) return;
    try {
      final bytes = await widget.assetUploadService.fetchBytes(id);
      if (mounted) setState(() => _previewBytes = bytes);
    } catch (_) {}
  }

  List<String> _parseTags(String raw) {
    return raw
        .split(',')
        .map((t) => t.trim())
        .where((t) => t.isNotEmpty)
        .toList();
  }

  Future<void> _pickImage() async {
    final l10n = AppLocalizations.of(context);
    final picker = ImagePicker();
    final file = await picker.pickImage(source: ImageSource.gallery);
    if (file == null) return;

    setState(() => _uploading = true);
    try {
      final bytes = await file.readAsBytes();
      final asset = await widget.assetUploadService.uploadBytes(
        bytes: Uint8List.fromList(bytes),
        filename: file.name,
        contentType: file.mimeType ?? 'image/jpeg',
      );
      if (!mounted) return;
      setState(() {
        _imageAssetId = asset.id;
        _previewBytes = Uint8List.fromList(bytes);
      });
      await _loadRecent();
    } on AssetUploadException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.message)),
      );
    } on GraphQLException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.localize(l10n))),
      );
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _pickRecent(Asset asset) async {
    setState(() {
      _imageAssetId = asset.id;
      _previewBytes = null;
    });
    await _loadPreview();
  }

  void _clearImage() {
    setState(() {
      _imageAssetId = null;
      _previewBytes = null;
    });
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) {
      _advancedKey.currentState?.expand();
      return;
    }

    setState(() => _saving = true);
    final l10n = AppLocalizations.of(context);
    try {
      final name = _nameController.text.trim();
      final description = _descriptionController.text.trim();
      final notes = _notesController.text.trim();
      final category = _categoryController.text.trim();
      final icon = _iconController.text.trim();
      final tags = _parseTags(_tagsController.text);

      if (widget.isEditing) {
        final existing = widget.definition!;
        await widget.rewardRepository.updateDefinition(
          id: existing.id,
          name: name,
          description: description.isEmpty ? '' : description,
          notes: notes.isEmpty ? '' : notes,
          category: category.isEmpty ? '' : category,
          tags: tags,
          color: _color,
          icon: icon.isEmpty ? '' : icon,
          imageAssetId: _imageAssetId,
          clearImage: existing.imageAssetId != null && _imageAssetId == null,
          stackable: _stackable,
        );
      } else {
        await widget.rewardRepository.createDefinition(
          name: name,
          description: description.isEmpty ? null : description,
          notes: notes.isEmpty ? null : notes,
          category: category.isEmpty ? null : category,
          tags: tags,
          color: _color,
          icon: icon.isEmpty ? null : icon,
          imageAssetId: _imageAssetId,
          stackable: _stackable,
        );
      }
      if (!mounted) return;
      Navigator.pop(context, true);
    } on GraphQLException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.localize(l10n))),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(
          widget.isEditing ? l10n.rewardsFormEdit : l10n.rewardsFormNew,
        ),
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(AppSpacing.screen),
          children: [
            AppCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextFormField(
                    controller: _nameController,
                    textCapitalization: TextCapitalization.sentences,
                    decoration: InputDecoration(
                      labelText: l10n.rewardsFormName,
                    ),
                    validator: (value) {
                      if (value == null || value.trim().isEmpty) {
                        return l10n.rewardsFormNameRequired;
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: AppSpacing.md),
                  TextFormField(
                    controller: _descriptionController,
                    decoration: InputDecoration(
                      labelText: l10n.rewardsFormDescription,
                    ),
                    maxLines: 2,
                    textCapitalization: TextCapitalization.sentences,
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  Text(
                    l10n.formGroupColor,
                    style: theme.textTheme.titleSmall,
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  Wrap(
                    spacing: AppSpacing.sm,
                    runSpacing: AppSpacing.sm,
                    children: [
                      for (final hex in kGroupColorPalette)
                        ColorSwatchButton(
                          color: parseGroupColor(hex),
                          selected: _color.toUpperCase() == hex.toUpperCase(),
                          onTap: () => setState(() => _color = hex),
                        ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            AppCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    l10n.rewardsFormImage,
                    style: theme.textTheme.titleSmall,
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  if (_previewBytes != null)
                    ClipRRect(
                      borderRadius: AppRadius.borderMd,
                      child: Image.memory(
                        _previewBytes!,
                        height: 120,
                        fit: BoxFit.cover,
                      ),
                    )
                  else if (_imageAssetId != null)
                    Container(
                      height: 80,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: theme.colorScheme.surfaceContainerHighest,
                        borderRadius: AppRadius.borderMd,
                      ),
                      child: Text(l10n.rewardsFormImageSelected(_imageAssetId!)),
                    ),
                  const SizedBox(height: AppSpacing.sm),
                  Row(
                    children: [
                      FilledButton.tonalIcon(
                        onPressed: _uploading ? null : _pickImage,
                        icon: _uploading
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Icon(Icons.image_outlined),
                        label: Text(l10n.rewardsFormPickImage),
                      ),
                      if (_imageAssetId != null) ...[
                        const SizedBox(width: AppSpacing.sm),
                        TextButton(
                          onPressed: _clearImage,
                          child: Text(l10n.rewardsFormClearImage),
                        ),
                      ],
                    ],
                  ),
                  if (_recentAssets.isNotEmpty) ...[
                    const SizedBox(height: AppSpacing.md),
                    Text(
                      l10n.rewardsFormRecentImages,
                      style: theme.textTheme.labelLarge,
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    Wrap(
                      spacing: AppSpacing.sm,
                      runSpacing: AppSpacing.sm,
                      children: [
                        for (final asset in _recentAssets.take(8))
                          ActionChip(
                            label: Text('#${asset.id}'),
                            onPressed: () => _pickRecent(asset),
                            avatar: _imageAssetId == asset.id
                                ? const Icon(Icons.check, size: 16)
                                : null,
                          ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            AdvancedFormSection(
              key: _advancedKey,
              initiallyExpanded: widget.isEditing && _hasAdvancedValues,
              hasConfiguredValues: _hasAdvancedValues,
              title: l10n.formAdvanced,
              configuredBadgeLabel: l10n.formAdvancedConfigured,
              children: [
                TextFormField(
                  controller: _notesController,
                  decoration: InputDecoration(
                    labelText: l10n.rewardsFormNotes,
                  ),
                  maxLines: 2,
                  onChanged: (_) => setState(() {}),
                ),
                const SizedBox(height: AppSpacing.md),
                TextFormField(
                  controller: _categoryController,
                  decoration: InputDecoration(
                    labelText: l10n.rewardsFormCategory,
                  ),
                  onChanged: (_) => setState(() {}),
                ),
                const SizedBox(height: AppSpacing.md),
                TextFormField(
                  controller: _tagsController,
                  decoration: InputDecoration(
                    labelText: l10n.rewardsFormTags,
                    hintText: l10n.rewardsFormTagsHint,
                  ),
                  onChanged: (_) => setState(() {}),
                ),
                const SizedBox(height: AppSpacing.md),
                TextFormField(
                  controller: _iconController,
                  decoration: InputDecoration(
                    labelText: l10n.rewardsFormIcon,
                    hintText: l10n.rewardsFormIconHint,
                  ),
                  onChanged: (_) => setState(() {}),
                ),
                const SizedBox(height: AppSpacing.md),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(l10n.rewardsFormStackable),
                  subtitle: Text(l10n.rewardsFormStackableHint),
                  value: _stackable,
                  onChanged: (v) => setState(() => _stackable = v),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.lg),
            FilledButton(
              onPressed: _saving ? null : _save,
              child: _saving
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(
                      widget.isEditing
                          ? l10n.formSaveChanges
                          : l10n.formCreate,
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

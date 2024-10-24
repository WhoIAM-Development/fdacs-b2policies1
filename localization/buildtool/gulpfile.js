require('dotenv').config({ path: __dirname + '/.env' });

const gulp = require('gulp');
const clean = require('gulp-clean');
const cheerio = require('cheerio');
const through2 = require('through2');
const fs = require('fs');
const readXlsxFile = require('read-excel-file/node')
const formatHTML = require('gulp-format-html')
var gulpRename = require("gulp-rename");
var gulpIgnore = require("gulp-ignore");
var path = require("path");

var baseConfig = require(process.env.POLICYBUILDER_PATHS_JSON_CONFIG ?? "../localization-config.json");
var splitByLanguage = process.env.POLICYBUILDER_SPLITBYLANG ?? false;

const paths = {
    destination: process.env.POLICYBUILDER_PATHS_DESTINATION ?? "../../dist/",
    policyFolderSrc: process.env.POLICYBUILDER_PATHS_POLICY_FOLDER_SRC ?? "../../Policies",
    dataFile: process.env.POLICYBUILDER_PATHS_XLSX ?? "../localization-combined.xlsx"
};

if (!paths.destination || !paths.policyFolderSrc || !paths.dataFile) {
    console.error(`Invalid paths configuration`);
    console.error(paths);
    process.exit(1);
}

let schema = {
    'Resource': {
        prop: 'Resource',
        type: String
    },
    'ResourceType': {
        prop: 'ResourceType',
        type: String
    },
    'ElementType': {
        prop: 'ElementType',
        type: String
    },
    'ElementId': {
        prop: 'ElementId',
        type: String
    },
    'StringId': {
        prop: 'StringId',
        type: String
    },
    'TargetCollection': {
        prop: 'TargetCol',
        type: String
    },
    'ItemValue': {
        prop: 'ItemValue',
        type: (value) => {
            return value.toString()
        }
    },
    'SelectByDefault': {
        prop: 'SelectByDefault',
        type: (value) => {
            return value.toString()
        }
    },
    'String Value': {
        prop: 'StringValue',
        type: String
    }
}

function cleanOutput() {
    return gulp.src(`${paths.destination}`, { allowEmpty: true })
        .pipe(clean({ force: true }))
}

function CopyDirectFiles() {

    let defaultFiles = baseConfig.localizations.map((localization) => localization.file);

    return (        
        gulp.src([`${paths.policyFolderSrc}/**.{xml,json}`])
            .pipe(gulpIgnore.exclude(function (file) {
                // Process selected files only
                return defaultFiles.some(item => item === path.parse(file.path).base);
            }))
            .pipe(formatHTML())
            .pipe(gulp.dest(`${paths.destination}`)));

}

function LocalizePolicies(cb) {

    readXlsxFile(paths.dataFile).then((rows) => {

        let languages = rows[0].filter((value) => !Object.keys(schema).includes(value));
        languages.forEach(lang => {
            schema[lang] = {
                prop: lang,
                type: String
            }
        });

        ReadExcelAndProcessPolicyFiles(languages);
    });
    // }

    cb();
}

function ReadExcelAndProcessPolicyFiles(allLanguages) {

    readXlsxFile(paths.dataFile, { schema, includeNullValues: true }).then(({ rows, errors }) => {

        if (errors.length <= 0) {

            baseConfig.localizations.forEach(localization => {

                let languages = allLanguages;

                if (localization.languages && localization.languages.length > 0) {
                    languages = localization.languages;
                }

                if(splitByLanguage){
                    languages.forEach(language => {
                        ProcessLocalizationFiles(language, rows,localization.file);
                    });
                }
                else{
                    ProcessLocalizationSingleFile(languages, rows, localization.file);
                }
            });

        }
        else {
            console.log(errors);
        }

    });
}
function ProcessLocalizationSingleFile(languages, localizations, file) {
    return (
        gulp.src([`${paths.policyFolderSrc}/${file}`])
            .pipe(through2.obj(function (file, _, cb) {

                // file is the current xml file that's being processed.
                // cb is the callback method which needs to be called with the modified file so the next pipe method can use it.                 

                file = TransformPolicySingleFile(languages, localizations, file)

                // ensure callback is called and current file is returned.     
                cb(null, file);
            }))
            .pipe(formatHTML())
            .pipe(gulp.dest(`${paths.destination}`)));
}
function TransformPolicySingleFile(languages, localizations, file) {
    let xmlString = file.contents.toString();
    let $ = cheerio.load(xmlString, { xmlMode: true, decodeEntities: false });

    if ($('TrustFrameworkPolicy').length <= 0) {
        return;
    }

    if ($('BasePolicy').length <= 0) {
        $('TrustFrameworkPolicy').prepend("<BasePolicy></BasePolicy>");
    }

    if ($('BuildingBlocks').length <= 0) {
        $('BasePolicy').after("<BuildingBlocks></BuildingBlocks>");
    }

    if ($('ContentDefinitions').length <= 0) {
        $('BuildingBlocks').prepend("<ContentDefinitions></ContentDefinitions>");
    }
    if ($('Localization').length <= 0) {
        $('ContentDefinitions').after('<Localization Enabled="true"><SupportedLanguages DefaultLanguage="' + languages[0] + '" MergeBehavior="Append"></SupportedLanguages>');
        // languages.forEach(language => {
        //     $('Localization SupportedLanguages').append('<SupportedLanguage>' + language + '</SupportedLanguage>');
        // });
    }
    if(baseConfig?.contentDefinitionMappings){

        baseConfig.contentDefinitionMappings.forEach(contentDefinitionMapping => {
            if (contentDefinitionMapping.localizedResourcesReferenceId) {
    
                if ($('ContentDefinition[Id="' + contentDefinitionMapping.contentDefinitionId + '"]').length <= 0) {
                    $('ContentDefinitions').append('<ContentDefinition Id="' + contentDefinitionMapping.contentDefinitionId + '"></ContentDefinition>');
                }
                if($('ContentDefinition[Id="' + contentDefinitionMapping.contentDefinitionId + '"] LocalizedResourcesReferences').length <= 0){
                    $('ContentDefinition[Id="' + contentDefinitionMapping.contentDefinitionId + '"]').append('<LocalizedResourcesReferences MergeBehavior="Append"></LocalizedResourcesReferences>');
                }
                else{
                    $('ContentDefinition[Id="' + contentDefinitionMapping.contentDefinitionId + '"] LocalizedResourcesReferences').empty();
                }
                languages.forEach(language =>{
                    $('ContentDefinition[Id="' + contentDefinitionMapping.contentDefinitionId + '"] LocalizedResourcesReferences').append('<LocalizedResourcesReference Language="' + language + '" LocalizedResourcesReferenceId="' + contentDefinitionMapping.localizedResourcesReferenceId + '.' + language + '" />');
                });
            }
        });
    }
    $('Localization SupportedLanguages').empty();
    $('Localization LocalizedResources LocalizedStrings').empty();
    languages.forEach(language =>{
        $('Localization SupportedLanguages').append('<SupportedLanguage>' + language + '</SupportedLanguage>');

        localizations.forEach(localization => {
    
            if ($('LocalizedResources[Id="' + localization.Resource + '.' + language + '"] LocalizedStrings').length <= 0) {
                $('Localization').append('<LocalizedResources Id="' + escapeXml(localization.Resource) + '.' + language + '"><LocalizedCollections></LocalizedCollections><LocalizedStrings></LocalizedStrings></LocalizedResources>');
            }
    
            if (localization.ResourceType === "LocalizedString") {
    
                let localizedString = $('<LocalizedString ElementType="' + escapeXml(localization.ElementType) + '" StringId="' + escapeXml(localization.StringId) + '">' + escapeXml(localization[language]) + '</LocalizedString>');
    
                if (localization.ElementId) {
                    $(localizedString).attr("ElementId", escapeXml(localization.ElementId));
                }
    
                $('LocalizedResources[Id="' + localization.Resource + '.' + language + '"] LocalizedStrings').append(localizedString);
            }
            else if (localization.ResourceType === "Collection") {
                let localizedCollection = $('<LocalizedCollection></LocalizedCollection>');
    
                if (localization.ElementType) {
                    $(localizedCollection).attr("ElementType", escapeXml(localization.ElementType));
                }
    
                if (localization.ElementId) {
                    $(localizedCollection).attr("ElementId", escapeXml(localization.ElementId));
                }
    
                if (localization.TargetCol) {
                    $(localizedCollection).attr("TargetCollection", escapeXml(localization.TargetCol));
                }
    
                $('LocalizedResources[Id="' + localization.Resource + '.' + language + '"] LocalizedCollections').append(localizedCollection);
    
                let localizedCollectionItems = localizations.filter(element => element.Resource == localization.Resource && element.ResourceType == "CollectionValues" && element.ElementId == localization.ElementId && element.TargetCol == localization.TargetCol);
    
                localizedCollectionItems.forEach(localizedCollectionItem => {
    
                    let item = $('<Item Text="' + escapeXml(localizedCollectionItem[language]) + '"></Item>');
    
                    if (localizedCollectionItem.ItemValue) {
                        $(item).attr("Value", escapeXml(localizedCollectionItem.ItemValue));
                    }
    
                    if (localizedCollectionItem.SelectByDefault) {
                        $(item).attr("SelectByDefault", escapeXml(localizedCollectionItem.SelectByDefault));
                    }
    
                    $('LocalizedResources[Id="' + localization.Resource + '.' + language + '"] LocalizedCollections LocalizedCollection').append(item);
    
                });
            }
        });
    })
    

    file.contents = Buffer.from($.xml())

    return file;
}

function ProcessLocalizationFiles(language, localizations, file) {
    return (
        gulp.src([`${paths.policyFolderSrc}/${file}`])
            .pipe(gulpRename(function (path) {
                // Rename the file by appending language code
                path.basename = path.basename + "_" + language;
            }))
            .pipe(through2.obj(function (file, _, cb) {

                // file is the current xml file that's being processed.
                // cb is the callback method which needs to be called with the modified file so the next pipe method can use it.                 

                file = TransformPolicy(language, localizations, file)

                // ensure callback is called and current file is returned.     
                cb(null, file);
            }))
            .pipe(formatHTML())
            .pipe(gulp.dest(`${paths.destination}`)));
}

function TransformPolicy(language, localizations, file) {
    let xmlString = file.contents.toString();
    let $ = cheerio.load(xmlString, { xmlMode: true, decodeEntities: false });

    if ($('TrustFrameworkPolicy').length <= 0) {
        return;
    }

    if ($('BasePolicy').length <= 0) {
        $('TrustFrameworkPolicy').prepend("<BasePolicy></BasePolicy>");
    }

    $('TrustFrameworkPolicy').attr("PolicyId", $('TrustFrameworkPolicy').attr("PolicyId") + "_" + language);
    $('TrustFrameworkPolicy').attr("PublicPolicyUri", $('TrustFrameworkPolicy').attr("PublicPolicyUri") + "_" + language);

    if ($('BuildingBlocks').length <= 0) {
        $('BasePolicy').after("<BuildingBlocks></BuildingBlocks>");
    }

    if ($('ContentDefinitions').length <= 0) {
        $('BuildingBlocks').prepend("<ContentDefinitions></ContentDefinitions>");
    }
    if ($('Localization').length <= 0) {
        $('ContentDefinitions').after('<Localization Enabled="true"><SupportedLanguages DefaultLanguage="' + language + '" MergeBehavior="Append"><SupportedLanguage>' + language + '</SupportedLanguage></SupportedLanguages>');
    }
    if(baseConfig?.contentDefinitionMappings){

        baseConfig.contentDefinitionMappings.forEach(contentDefinitionMapping => {
            if (contentDefinitionMapping.localizedResourcesReferenceId) {
    
                if ($('ContentDefinition[Id="' + contentDefinitionMapping.contentDefinitionId + '"]').length <= 0) {
                    $('ContentDefinitions').append('<ContentDefinition Id="' + contentDefinitionMapping.contentDefinitionId + '"></ContentDefinition>');
                }
    
                $('ContentDefinition[Id="' + contentDefinitionMapping.contentDefinitionId + '"]').append('<LocalizedResourcesReferences MergeBehavior="Append"><LocalizedResourcesReference Language="' + language + '" LocalizedResourcesReferenceId="' + contentDefinitionMapping.localizedResourcesReferenceId + '.' + language + '" /></LocalizedResourcesReferences>');
            }
        });
    }


    localizations.forEach(localization => {

        if ($('LocalizedResources[Id="' + localization.Resource + '.' + language + '"] LocalizedStrings').length <= 0) {
            $('Localization').append('<LocalizedResources Id="' + escapeXml(localization.Resource) + '.' + language + '"><LocalizedCollections></LocalizedCollections><LocalizedStrings></LocalizedStrings></LocalizedResources>');
        }

        if (localization.ResourceType === "LocalizedString") {

            let localizedString = $('<LocalizedString ElementType="' + escapeXml(localization.ElementType) + '" StringId="' + escapeXml(localization.StringId) + '">' + escapeXml(localization[language]) + '</LocalizedString>');

            if (localization.ElementId) {
                $(localizedString).attr("ElementId", escapeXml(localization.ElementId));
            }

            $('LocalizedResources[Id="' + localization.Resource + '.' + language + '"] LocalizedStrings').append(localizedString);
        }
        else if (localization.ResourceType === "Collection") {
            let localizedCollection = $('<LocalizedCollection></LocalizedCollection>');

            if (localization.ElementType) {
                $(localizedCollection).attr("ElementType", escapeXml(localization.ElementType));
            }

            if (localization.ElementId) {
                $(localizedCollection).attr("ElementId", escapeXml(localization.ElementId));
            }

            if (localization.TargetCol) {
                $(localizedCollection).attr("TargetCollection", escapeXml(localization.TargetCol));
            }

            $('LocalizedResources[Id="' + localization.Resource + '.' + language + '"] LocalizedCollections').append(localizedCollection);

            let localizedCollectionItems = localizations.filter(element => element.Resource == localization.Resource && element.ResourceType == "CollectionValues" && element.ElementId == localization.ElementId && element.TargetCol == localization.TargetCol);

            localizedCollectionItems.forEach(localizedCollectionItem => {

                let item = $('<Item Text="' + escapeXml(localizedCollectionItem[language]) + '"></Item>');

                if (localizedCollectionItem.ItemValue) {
                    $(item).attr("Value", escapeXml(localizedCollectionItem.ItemValue));
                }

                if (localizedCollectionItem.SelectByDefault) {
                    $(item).attr("SelectByDefault", escapeXml(localizedCollectionItem.SelectByDefault));
                }

                $('LocalizedResources[Id="' + localization.Resource + '.' + language + '"] LocalizedCollections LocalizedCollection').append(item);

            });
        }
    });

    file.contents = Buffer.from($.xml())

    return file;
}

function escapeXml(unsafe) {
    if(!unsafe){
        return "";
    }
    return unsafe.replace(/[<>&'"]/g, function (c) {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
        }
    });
}

exports.dev = gulp.series(cleanOutput, CopyDirectFiles,LocalizePolicies);